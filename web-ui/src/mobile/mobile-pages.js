// Mobile pages — render functions for every mobile route.
import {
  chatMessages, recentCommands, mobileSchedules, mobileTeams, mobileTeamDetail,
} from './mobile-data.js';
import {
  ICONS, icon, escapeHtml, el, renderMobileHeader, wireHeaderActions, openDrawer, invalidateMobileDrawerSessions,
} from './mobile-shell.js?v=mobile-voice-live-update-fix';
import { memoryPageActivate, memoryPageUnmount } from '../pages/MemoryPage.js';
import {
  loadMobileSchedules, toggleSchedule, runScheduleNow,
  loadMobileTeams, loadMobileTeamDetail,
  startTeamRun, pauseTeam, resumeTeam, triggerTeamReview, deleteTeam,
  saveTeamContextReference, invalidateTeamsCache,
  streamChat, MOBILE_CHAT_SESSION_ID, createMobileChatSessionId, createMobileChatSession,
  loadGatewayStatus, loadLatestUsableSession, loadMobileChatSession, loadMobileChatRunStatus, loadMobileChatRunStatuses, loadMobileChatStreamReplay,
  updateMobileChatSessionHistory, markMobileEditRerunReset, markMobileChatSessionRead,
  loadTeamRuns, loadTeamChat, postTeamChat, loadTeamRoomState, streamTeamChat, loadTeamChatStreamReplay,
  claimPairing, pollPairing, verifyPairingMe,
  createVoiceInterruptionEvent, streamVoiceAgentInputMobile,
  getDeviceToken, setDeviceToken, clearDeviceToken,
  mobileGatewayFetch, mobileGatewayTextFetch, buildMobileGatewayWsUrl,
  loadTeamWorkspace, loadTeamWorkspaceFile, loadMemoryGraph,
  loadBgTasks, loadBgTaskDetail, loadBgTaskEvidence, sendBgTaskMessage, runBgTaskAction, loadVoiceStatus,
  transcribeVoiceAudio, synthesizeVoiceAudio, loadVoiceVoices,
  loadMobileMoreSummary, loadMobileHubOverview, loadMobileAuditRuns, loadMobileMemoryOverview,
  applyMobileSkillCuratorSuggestion, denyMobileSkillCuratorSuggestion,
  loadMobileProposals, loadMobileProposal, approveMobileProposal, denyMobileProposal,
  loadMobileApprovals, approveMobileApproval, denyMobileApproval,
  loadMobileProcessRuns, loadMobileProcessRunLog, rerunMobileProcessRun, killMobileProcessRun, submitMobileProcessInput,
  uploadMobileTextFile, uploadMobileBinaryFile,
  loadMobileCommandModels, loadMobileStopTargets, stopMobileMainChat, stopMobileRuntime,
  runMobileScreenshotCommand, restartMobileGateway,
  loadMobileWorkspaceFiles, loadMobileFileScreenshot,
  loadCanvasImageDataUrl, creativeExtractLayers, loadCreativeGallery, buildInlineMediaUrl,
  loadMobileSubagents, loadMobileSubagentDetail, loadSubagentSystemPrompt, loadSubagentHeartbeat,
  tickSubagentHeartbeat, loadSubagentRuns, loadSubagentChat, loadSubagentContextRefs,
  spawnSubagentTask, streamSubagentChat, loadSubagentChatStreamReplay,
} from './mobile-api.js';
import { checkSessionDetailed, getAccount, mountLoginScreen } from '../auth/account.js';
import { renderMd } from '../utils.js';
import { wsEventBus, wsSend } from '../ws.js';

// ---------- tiny toast ----------
function pmToast(msg, kind = 'info') {
  let host = document.getElementById('pm-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'pm-toast-host';
    host.style.cssText = 'position:fixed;left:0;right:0;bottom:calc(var(--pm-tabbar-h) + env(safe-area-inset-bottom) + 16px);display:flex;flex-direction:column;align-items:center;gap:8px;z-index:9999;pointer-events:none;';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  const bg = kind === 'error' ? '#d8473a' : kind === 'success' ? '#2fae66' : '#221a14';
  t.style.cssText = `background:${bg};color:#fff;padding:10px 16px;border-radius:999px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.18);max-width:88vw;text-align:center;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s;`;
  t.textContent = msg;
  host.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; setTimeout(() => t.remove(), 220); }, 2400);
}

const FLAME = '<span class="pm-brand-flame">🔥</span>';
const PM_CHAT_VOICE_ICON_SRC = '/assets/icons8-sound-wave-50.apng.png';

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

/* ---------------- CHAT ---------------- */

// Persistent in-tab thread. Survives navigation between mobile pages.
const PM_MOBILE_ACTIVE_RUN_KEY = 'pm_mobile_active_chat_run';
const PM_MOBILE_ACTIVE_RUNS_KEY = 'pm_mobile_active_chat_runs';
const PM_MOBILE_LAST_CHAT_SESSION_KEY = 'pm_mobile_last_chat_session';
const PM_MOBILE_SIDE_CHAT_LINKS_KEY = 'prometheus_side_chat_links_v1';

const __pmChat = (window.__pmChat = window.__pmChat || {
  activeSessionId: MOBILE_CHAT_SESSION_ID,
  threads: { [MOBILE_CHAT_SESSION_ID]: chatMessages.slice() },
  attachments: {},
  thread: chatMessages.slice(),  // legacy alias for the active thread
  busy: false,
  abort: null,
  activeRuns: {},
  drawerRunSessionIds: new Set(),
  statusTimer: null,
  recoverTimer: null,
  renderTimers: {},
  pendingApprovals: {},
  sentClientRequestIds: {},
  queuedPrompts: {},
  editingMessageIndex: -1,
});

function _activeMobileThread() {
  const sid = __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID;
  if (!__pmChat.threads[sid]) __pmChat.threads[sid] = [];
  __pmChat.thread = __pmChat.threads[sid];
  return __pmChat.thread;
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

function _markMobileSessionRunning(sessionId, running) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  if (!(__pmChat.drawerRunSessionIds instanceof Set)) __pmChat.drawerRunSessionIds = new Set();
  if (running) __pmChat.drawerRunSessionIds.add(sid);
  else __pmChat.drawerRunSessionIds.delete(sid);
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
  _clearMobileLastChatSession();
  __pmChat.activeSessionId = MOBILE_CHAT_SESSION_ID;
  __pmChat.threads[MOBILE_CHAT_SESSION_ID] = [];
  __pmChat.attachments[MOBILE_CHAT_SESSION_ID] = [];
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
  __pmChat.threads[MOBILE_CHAT_SESSION_ID] = [];
  __pmChat.attachments[MOBILE_CHAT_SESSION_ID] = [];
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

function _serverRoleToMobileRole(role) {
  return String(role || '').toLowerCase() === 'user' ? 'user' : 'ai';
}

function _mobileRoleToServerRole(role) {
  return String(role || '').toLowerCase() === 'user' ? 'user' : 'assistant';
}

function _isMobileRestartContextPacketText(value) {
  return /^Restart Context Packet\b/i.test(String(value || '').trim());
}

function _isMobileInternalServerMessage(m) {
  return m?.sideChatBoundary === true
    || (_isMobileRestartContextPacketText(m?.content) && !Array.isArray(m?.fileChanges?.files));
}

function _mapServerHistoryToMobile(history) {
  return (Array.isArray(history) ? history : [])
    .filter((msg) => !_isMobileInternalServerMessage(msg))
    .map((msg, index) => _mapServerMessageToMobile(msg, index))
    .filter(Boolean);
}

function _mapServerMessageToMobile(m, index = -1) {
  if (_isMobileInternalServerMessage(m)) return null;
  const role = _serverRoleToMobileRole(m?.role);
  const content = String(m?.content || '');
  const attachmentPreviews = Array.isArray(m?.attachmentPreviews) ? m.attachmentPreviews : [];
  return {
    role,
    sourceIndex: Number.isFinite(Number(index)) ? Number(index) : -1,
    timestamp: Number(m?.timestamp || Date.now()) || Date.now(),
    workStartedAt: Number(m?.workStartedAt || 0) || undefined,
    workEndedAt: Number(m?.workEndedAt || 0) || undefined,
    workDurationMs: Number.isFinite(Number(m?.workDurationMs)) ? Number(m.workDurationMs) : undefined,
    time: m?.timestamp ? _formatChatTime(m.timestamp) : '',
    body: { sender: role === 'user' ? '' : 'Prometheus', text: content, attachments: attachmentPreviews },
    content,
    attachmentPreviews,
    _promptVariants: Array.isArray(m?._promptVariants) ? m._promptVariants : undefined,
    _promptVariantActive: Number.isFinite(Number(m?._promptVariantActive)) ? Number(m._promptVariantActive) : undefined,
    generatedImages: Array.isArray(m?.generatedImages) ? m.generatedImages : [],
    generatedVideos: Array.isArray(m?.generatedVideos) ? m.generatedVideos : [],
    artifacts: Array.isArray(m?.artifacts) ? m.artifacts : [],
    files: Array.isArray(m?.canvasFiles) ? m.canvasFiles : [],
    fileChanges: m?.fileChanges && typeof m.fileChanges === 'object' ? m.fileChanges : undefined,
    productCarousel: m?.productCarousel && typeof m.productCarousel === 'object' ? m.productCarousel : undefined,
    richArtifacts: Array.isArray(m?.richArtifacts) && m.richArtifacts.length ? m.richArtifacts : undefined,
    sideChatBoundary: m?.sideChatBoundary === true,
    voiceAgentWorkerHandoff: m?.voiceAgentWorkerHandoff === true,
    source: String(m?.source || ''),
    channelLabel: String(m?.channelLabel || ''),
    workflowLabel: String(m?.workflowLabel || ''),
    processEntries: Array.isArray(m?.processEntries) ? m.processEntries.map((entry) => ({
      id: entry?.id || `proc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: String(entry?.type || 'info'),
      text: String(entry?.text || entry?.content || ''),
      extra: entry?.extra || null,
      time: entry?.time || (entry?.ts ? _formatChatTime(entry.ts) : ''),
    })).filter((entry) => entry.text) : [],
  };
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
  return String(msg?.content || msg?.body?.text || '').trim();
}

function _isMobileVoiceAgentWorkerHandoff(msg) {
  const label = String(msg?.channelLabel || msg?.source || msg?.body?.source || '').toLowerCase();
  return msg?.voiceAgentWorkerHandoff === true
    || label.includes('voice agent handoff')
    || label.includes('realtime agent dispatch');
}

function _isMobileHiddenVoiceDraftMessage(msg, index = -1) {
  const text = _mobileMessageCopyText(msg);
  const isDraftText = /^Mobile voice chat$/i.test(text)
    || (Number(index) <= 1 && /^New Chat$/i.test(text));
  return isDraftText
    && !Array.isArray(msg?.body?.attachments)
    && !Array.isArray(msg?.attachmentPreviews);
}

function _mobileHistoryForServer(thread = _activeMobileThread()) {
  return (Array.isArray(thread) ? thread : [])
    .filter((msg, index) => msg && (msg.role === 'user' || msg.role === 'ai') && !_isMobileHiddenVoiceDraftMessage(msg, index))
    .filter((msg) => !msg.streaming)
    .filter((msg) => !_isMobileRestartContextPacketText(_mobileMessageCopyText(msg)))
    .filter((msg) => !msg._isRestartNotification)
    .map((msg) => ({
      ..._cloneMobileMessageForBranch(msg),
      role: _mobileRoleToServerRole(msg.role),
      content: _mobileMessageCopyText(msg),
      timestamp: Number(msg.timestamp) || Date.now(),
      attachmentPreviews: Array.isArray(msg.attachmentPreviews)
        ? msg.attachmentPreviews.map(_sanitizeMobileAttachmentPreviewForServer)
        : (Array.isArray(msg.body?.attachments) ? msg.body.attachments.map(_sanitizeMobileAttachmentPreviewForServer) : undefined),
    }))
    .filter((msg) => msg.content.trim())
    .map((msg, index) => ({ ...msg, sourceIndex: index }));
}

function _sanitizeMobileAttachmentPreviewForServer(attachment) {
  if (!attachment || typeof attachment !== 'object') return attachment;
  const next = { ...attachment };
  const hasDurablePath = !!String(next.workspacePath || next.path || next.filePath || '').trim();
  if (hasDurablePath) {
    delete next.dataUrl;
    delete next.base64;
    delete next.file;
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

function _makeMobileUserMessage(text, attachments = []) {
  const content = String(text || '').trim();
  const attachmentPreviews = Array.isArray(attachments) ? attachments.map(_sanitizeMobileAttachmentPreviewForServer) : [];
  return {
    role: 'user',
    time: _nowTime(),
    timestamp: Date.now(),
    body: { text: content, attachments },
    content,
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

function _formatChatTime(value) {
  try {
    const d = new Date(Number(value || Date.now()));
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
  } catch {
    return '';
  }
}

function _rememberMobileActiveRun(sessionId, state = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  try {
    const runs = JSON.parse(localStorage.getItem(PM_MOBILE_ACTIVE_RUNS_KEY) || '{}') || {};
    const prev = runs[sid] || {};
    const entry = {
      sessionId: sid,
      startedAt: Number(state.startedAt || prev.startedAt || Date.now()),
      updatedAt: Date.now(),
      disconnected: state.disconnected === true || prev.disconnected === true,
      streamId: state.streamId ? String(state.streamId) : String(prev.streamId || ''),
      lastSeq: Math.max(
        Math.max(0, Math.floor(Number(prev.lastSeq || 0)) || 0),
        Math.max(0, Math.floor(Number(state.lastSeq || 0)) || 0),
      ),
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

function _getMobileQueuedPrompts(sessionId = '') {
  const sid = String(sessionId || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
  if (!__pmChat.queuedPrompts || typeof __pmChat.queuedPrompts !== 'object') __pmChat.queuedPrompts = {};
  if (!Array.isArray(__pmChat.queuedPrompts[sid])) __pmChat.queuedPrompts[sid] = [];
  return __pmChat.queuedPrompts[sid];
}

function _makeMobileQueuedPrompt(message, files = []) {
  return {
    id: `mq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    message: String(message || '').trim(),
    files: Array.isArray(files) ? files.slice() : [],
    createdAt: Date.now(),
  };
}

function _moveMobileQueuedPromptToComposer(sessionId, index) {
  const sid = String(sessionId || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
  const queue = _getMobileQueuedPrompts(sid);
  if (!Number.isInteger(index) || index < 0 || index >= queue.length) return;
  const item = queue.splice(index, 1)[0] || {};
  const input = document.getElementById('pm-composer-input');
  if (input) {
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
    const entries = Array.isArray(latestAi.processEntries) ? latestAi.processEntries.slice() : [];
    if (latestAi.streaming) {
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
        workflowLabel: 'Tool stream before steer',
      });
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
    workflowLabel: 'Steer',
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
  if (!__pmChat.activeRuns?.[sid]?.busy) {
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
    _appendMobileQueuedSteerTurn(sid, steerMessage, result || {});
    pmToast(files.length ? 'Queued steer sent with files.' : 'Queued steer sent.', 'success');
  } catch (err) {
    pmToast(`Steer failed: ${err?.message || err}`, 'error');
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
    return;
  }
  panel.hidden = false;
  panel.innerHTML = `
    <div class="pm-mobile-queued-head"><span>Queued prompts</span><b>${queue.length}</b></div>
    <div class="pm-mobile-queued-list">
      ${queue.map((item, index) => `
        <div class="pm-mobile-queued-item">
          <button type="button" class="pm-mobile-queued-text" data-edit-mobile-queued="${index}" aria-label="Edit queued prompt">${escapeHtml(String(item.message || 'Attached file(s)').slice(0, 140))}${Array.isArray(item.files) && item.files.length ? ` <em>+${item.files.length}</em>` : ''}</button>
          <div class="pm-mobile-queued-actions">
            <button type="button" class="pm-mobile-queued-icon pm-mobile-queued-steer" data-steer-mobile-queued="${index}" aria-label="Steer queued prompt" title="Steer">${ICONS.send}</button>
            <button type="button" class="pm-mobile-queued-icon pm-mobile-queued-remove" data-remove-mobile-queued="${index}" aria-label="Remove queued prompt" title="Remove">${ICONS.trash}</button>
          </div>
        </div>
      `).join('')}
    </div>`;
  panel.querySelectorAll('[data-edit-mobile-queued]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-edit-mobile-queued'));
      _moveMobileQueuedPromptToComposer(sid, idx);
    });
  });
  panel.querySelectorAll('[data-steer-mobile-queued]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-steer-mobile-queued'));
      _steerMobileQueuedPrompt(sid, idx);
    });
  });
  panel.querySelectorAll('[data-remove-mobile-queued]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-remove-mobile-queued'));
      if (Number.isInteger(idx) && idx >= 0 && idx < queue.length) {
        queue.splice(idx, 1);
        _renderMobileQueuedPromptsPanel(sid);
      }
    });
  });
}

function _findLatestAssistantTurn(thread) {
  const list = Array.isArray(thread) ? thread : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.role === 'ai') return list[i];
  }
  return null;
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

function _mergeMobileAssistantTurnDetails(target, source) {
  if (!target || !source || target === source) return target;
  const mergeList = (key) => {
    const existing = Array.isArray(target[key]) ? target[key] : [];
    const incoming = Array.isArray(source[key]) ? source[key] : [];
    if (!incoming.length) return;
    const seen = new Set(existing.map((item) => JSON.stringify(item)));
    target[key] = existing.slice();
    incoming.forEach((item) => {
      const id = JSON.stringify(item);
      if (!seen.has(id)) {
        seen.add(id);
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
  if (Array.isArray(source.richArtifacts) && source.richArtifacts.length && !(Array.isArray(target.richArtifacts) && target.richArtifacts.length)) {
    target.richArtifacts = source.richArtifacts;
  }
  if (!target.fileChanges && source.fileChanges) target.fileChanges = source.fileChanges;
  if (!target.approvalRequest && source.approvalRequest) target.approvalRequest = source.approvalRequest;
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
  target.streaming = target.streaming === true || (
    source.streaming === true
    && !target.workEndedAt
    && !Number.isFinite(Number(target.workDurationMs))
  );
  return target;
}

function _dedupeMobileAssistantTurns(thread = _activeMobileThread()) {
  const list = Array.isArray(thread) ? thread : [];
  const seen = new Map();
  for (let i = 0; i < list.length; i += 1) {
    const msg = list[i];
    const key = _mobileAssistantContentKey(msg);
    if (!key) {
      if (msg?.role === 'user') seen.clear();
      continue;
    }
    const prevIndex = seen.get(key);
    if (prevIndex == null) {
      seen.set(key, i);
      continue;
    }
    const previous = list[prevIndex];
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

function _renderMobileWorkTimer(msg) {
  if (!_isMobileAssistantMessage(msg)) return '';
  const startedAt = _mobileAssistantWorkStartedAt(msg);
  if (!startedAt) return '';
  const active = msg?.streaming === true;
  const endedAt = Number(msg?.workEndedAt || 0);
  const duration = active
    ? Date.now() - startedAt
    : (Number.isFinite(Number(msg?.workDurationMs)) && Number(msg.workDurationMs) >= 0
      ? Number(msg.workDurationMs)
      : ((Number.isFinite(endedAt) && endedAt > 0 ? endedAt : Number(msg?.timestamp || Date.now())) - startedAt));
  return `<div class="pm-work-timer">${active ? 'Working for' : 'Worked for'} ${escapeHtml(_formatMobileWorkDuration(duration))}</div>`;
}

function _renderMobileMarkdown(text) {
  const raw = String(text || '');
  if (!raw.trim()) return '';
  try {
    return renderMd(raw);
  } catch {
    return escapeHtml(raw).replace(/\n/g, '<br>');
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
  return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function _makeProcessEntry(type, text, extra = null) {
  const content = String(text || '').trim();
  if (!content) return null;
  return {
    id: `proc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: String(type || 'info'),
    text: content,
    extra,
    time: _nowTime(),
  };
}

function _appendMobileProcess(message, type, text, extra = null) {
  if (!message) return;
  if (!Array.isArray(message.processEntries)) message.processEntries = [];
  const entry = _makeProcessEntry(type, text, extra);
  if (!entry) return;
  const prev = message.processEntries[message.processEntries.length - 1];
  if (prev && prev.type === entry.type && prev.text === entry.text) return;
  message.processEntries.push(entry);
  if (message.processEntries.length > 120) message.processEntries.splice(0, message.processEntries.length - 120);
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

function _renderMobileProcess(entries, options = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return '';
  const forceClosed = options.collapsed === true;
  const recent = list.slice(-5);
  const full = list.map((entry) => `
    <div class="pm-process-row ${escapeHtml(entry.type)}">
      <span>${escapeHtml(entry.type)}</span>
      <p>${escapeHtml(entry.text)}</p>
    </div>
  `).join('');
  return `
    <details class="pm-process-stream"${!forceClosed && list.length <= 2 ? ' open' : ''}>
      <summary><span>Process</span><em>${list.length} event${list.length === 1 ? '' : 's'}</em></summary>
      <div class="pm-process-latest">${recent.map((entry) => `<b>${escapeHtml(entry.text)}</b>`).join('')}</div>
      <div class="pm-process-full">${full}</div>
    </details>
  `;
}

function _appendMobileLiveTrace(message, type, text, { append = false } = {}) {
  if (!message) return;
  const content = String(text || '');
  if (!content) return;
  if (_isMobileStartupStatusText(content)) return;
  if (!Array.isArray(message.liveTraceEntries)) message.liveTraceEntries = [];
  const normalizedType = String(type || 'info').toLowerCase();
  const last = message.liveTraceEntries[message.liveTraceEntries.length - 1];
  if (append && last && last.type === normalizedType) {
    last.text = `${last.text || ''}${content}`;
  } else {
    const trimmed = content.trim();
    if (!trimmed) return;
    if (last && last.type === normalizedType && String(last.text || '').trim() === trimmed) return;
    message.liveTraceEntries.push({ type: normalizedType, text: trimmed, time: _nowTime() });
  }
}

function _isMobileStartupStatusText(value) {
  return /^(request received\. starting chat turn|preparing chat context|preparing prometheus runtime|building model context)/i
    .test(String(value || '').trim());
}

function _mergeMobileLiveTraceIntoProcess(message) {
  if (!message) return;
  const traces = Array.isArray(message.liveTraceEntries) ? message.liveTraceEntries : [];
  if (!traces.length) return;
  if (!Array.isArray(message.processEntries)) message.processEntries = [];
  const existing = new Set(message.processEntries.map((entry) =>
    `${String(entry?.type || '').toLowerCase()}|${String(entry?.text || entry?.content || '').replace(/\s+/g, ' ').trim()}`
  ));
  for (const trace of traces) {
    const type = String(trace?.type || 'info').toLowerCase();
    const text = String(trace?.text || '').trim();
    if (!text || (type !== 'preamble' && type !== 'think')) continue;
    const key = `${type}|${text.replace(/\s+/g, ' ').trim()}`;
    if (existing.has(key)) continue;
    existing.add(key);
    message.processEntries.unshift({
      id: `trace_proc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type,
      text,
      time: String(trace?.time || _nowTime()),
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
    const text = String(trace?.text || '').trim();
    if (!text || (type !== 'preamble' && type !== 'think')) continue;
    const key = `${type}|${text.replace(/\s+/g, ' ').trim()}`;
    if (existing.has(key)) continue;
    existing.add(key);
    liveEntries.push({
      id: `trace_proc_preview_${liveEntries.length}`,
      type,
      text,
      time: String(trace?.time || _nowTime()),
    });
  }
  return liveEntries.length ? [...liveEntries, ...out] : out;
}

function _moveMobilePreToolAnswerIntoPreamble(message) {
  if (!message || message.toolActivityStarted) return;
  const text = String(message.body?.text || message.content || '').trim();
  if (!text) return;
  _appendMobileLiveTrace(message, 'preamble', text);
  if (message.body) message.body.text = '';
  message.content = '';
  message.finalResponseStarted = false;
}

function _renderMobileLiveTrace(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter((entry) => String(entry?.text || '').trim());
  if (!list.length) return '';
  return `<div class="pm-live-trace">${list.map((entry) => {
    const type = String(entry.type || 'info').toLowerCase();
    const text = String(entry.text || '').trim();
    if (type === 'preamble' || type === 'think' || type === 'assistant') {
      return `<div class="pm-live-prose ${escapeHtml(type)}"><div class="pm-live-md">${_renderMobileMarkdown(text)}</div></div>`;
    }
    const label = type === 'result' ? 'Tool result' : type === 'error' ? 'Tool error' : 'Tool';
    const body = `<div class="pm-live-text">${escapeHtml(text)}</div>`;
    return `<div class="pm-live-segment ${escapeHtml(type)}"><span>${escapeHtml(label)}</span>${body}</div>`;
  }).join('')}</div>`;
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
  const endpoint = mode === 'download' ? '/api/canvas/download' : '/api/canvas/inline';
  return media.path ? `${endpoint}?path=${encodeURIComponent(media.path)}` : '#';
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

function _collectMessageMedia(m) {
  const b = m.body || {};
  const fromImages = _normalizeMobileMediaList(m.generatedImages || b.generatedImages).map(x => ({ ...x, kind: 'image' }));
  const fromVideos = _normalizeMobileMediaList(m.generatedVideos || b.generatedVideos).map(x => ({ ...x, kind: 'video' }));
  const fromFiles = _normalizeMobileMediaList(b.files || m.files);
  const fromArtifacts = _normalizeMobileMediaList((Array.isArray(m.artifacts) ? m.artifacts : []).flatMap((a) => [a?.path, a?.to_path, a?.from_path].filter(Boolean)));
  const all = [...fromImages, ...fromVideos, ...fromFiles, ...fromArtifacts];
  const seen = new Set();
  return all.filter((media) => {
    const key = media.dataUrl || media.path || media.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function _mergeMobileThreadLocalArtifacts(nextThread, localThread) {
  const next = Array.isArray(nextThread) ? nextThread : [];
  const local = Array.isArray(localThread) ? localThread : [];
  if (!local.length) return next;
  if (!next.length) return local;
  next.forEach((msg, index) => {
    if (!msg || msg.role !== 'ai') return;
    const localSameSlot = local[index]?.role === 'ai' ? local[index] : null;
    const localBySource = local.find((candidate) => (
      candidate?.role === 'ai'
      && Number.isFinite(Number(candidate.sourceIndex))
      && Number(candidate.sourceIndex) === Number(msg.sourceIndex)
    ));
    const localCandidate = localSameSlot || localBySource;
    if (localCandidate) {
      _mergeMobileAssistantTurnDetails(msg, localCandidate);
      _mergeMobileMediaIntoMessage(msg, _collectMessageMedia(localCandidate));
      _mergeMobileProductCarouselIntoMessage(msg, localCandidate.productCarousel);
    }
  });
  const localLatest = _findLatestAssistantTurn(local);
  const nextLatest = _findLatestAssistantTurn(next);
  if (localLatest && nextLatest) {
    _mergeMobileAssistantTurnDetails(nextLatest, localLatest);
    _mergeMobileMediaIntoMessage(nextLatest, _collectMessageMedia(localLatest));
    _mergeMobileProductCarouselIntoMessage(nextLatest, localLatest.productCarousel);
  }
  const hasMatchingTurn = (candidate) => {
    if (!candidate || typeof candidate !== 'object') return true;
    const role = String(candidate.role || '');
    const clientRequestId = String(candidate._clientRequestId || '').trim();
    const text = _mobileMessageCopyText(candidate).replace(/\s+/g, ' ').trim();
    return next.some((msg) => {
      if (!msg || String(msg.role || '') !== role) return false;
      if (clientRequestId && String(msg._clientRequestId || '').trim() === clientRequestId) return true;
      const msgText = _mobileMessageCopyText(msg).replace(/\s+/g, ' ').trim();
      return !!text && !!msgText && msgText === text;
    });
  };
  for (const msg of local) {
    if (!msg || (msg.role !== 'user' && msg.role !== 'ai')) continue;
    if (_isMobileHiddenVoiceDraftMessage(msg, -1)) continue;
    const isPendingAssistant = msg.role === 'ai' && (msg.streaming || String(msg._clientRequestId || '').trim());
    const isPendingUser = msg.role === 'user' && !hasMatchingTurn(msg);
    if ((isPendingAssistant || isPendingUser) && !hasMatchingTurn(msg)) {
      next.push(msg);
    }
  }
  return next;
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
  _clearMobileLiveRunForSession(sid);
  const session = await loadMobileChatSession(sid).catch(() => null);
  const history = Array.isArray(session?.history) ? session.history : [];
  const mapped = _mapServerHistoryToMobile(history);
  const localThread = __pmChat.threads?.[sid] || [];
  __pmChat.threads[sid] = _mergeMobileThreadLocalArtifacts(mapped, localThread);
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
  if (!__pmChat.threads[sid].some((item) => _mobileMessageCopyText(item) === String(msg.text || '')) && String(msg.text || '').trim()) {
    __pmChat.threads[sid].push({
      role: 'ai',
      timestamp: Date.now(),
      time: _nowTime(),
      body: { sender: 'Prometheus', text: String(msg.text || '') },
      content: String(msg.text || ''),
      _isRestartNotification: true,
    });
  }
  // Only take over the chat view if the user is currently viewing that session
  // or a real (non-draft) session. Never override an intentional new-chat state —
  // the user pressed New Chat and shouldn't be yanked back to an old session.
  const _restartActiveSid = String(__pmChat.activeSessionId || '').trim();
  if (_restartActiveSid === sid || (_restartActiveSid !== MOBILE_CHAT_SESSION_ID && location.hash.startsWith('#mobile/chat'))) {
    __pmChat.activeSessionId = sid;
    _activeMobileThread();
    const threadEl = document.getElementById('pm-chat-thread');
    const bodyEl = document.getElementById('pm-chat-body');
    if (threadEl) _flushThreadRender(threadEl, bodyEl, sid);
  }
  markMobileChatSessionRead(sid, Date.now()).catch(() => {});
  if (msg.notificationId) {
    try { wsSend({ type: 'startup_notification_ack', notificationId: String(msg.notificationId) }); } catch {}
  }
}

if (!window.__pmMobileSessionNotificationBridgeInstalled) {
  window.__pmMobileSessionNotificationBridgeInstalled = true;
  wsEventBus.on('session_notification', (msg = {}) => {
    if (String(msg.source || '') === 'hot_restart') {
      _applyMobileHotRestartNotification(msg).catch((err) => {
        pmToast(`Restart message sync failed: ${err?.message || err}`, 'error');
      });
    }
  });
}

function _deliveryNotificationToMobileMedia(msg = {}) {
  const imageDataUrl = String(msg.imageDataUrl || '').trim();
  const attachmentPath = String(msg.attachmentPath || '').trim();
  if (!imageDataUrl && !attachmentPath) return null;
  return _normalizeMobileMedia({
    kind: imageDataUrl ? 'image' : _mobileMediaKind({ path: attachmentPath, name: msg.fileName }),
    dataUrl: imageDataUrl,
    path: attachmentPath,
    name: String(msg.fileName || msg.caption || (imageDataUrl ? 'Delivered image.png' : attachmentPath.split(/[\\/]/).pop()) || 'Delivered file').trim(),
    mimeType: msg.mimeType || (imageDataUrl.match(/^data:([^;]+);/i)?.[1] || ''),
  });
}

function _appendMobileDeliveryNotification(msg = {}) {
  const sid = String(msg.sessionId || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
  if (!__pmChat.threads[sid]) __pmChat.threads[sid] = [];
  const text = String(msg.text || msg.caption || '').trim();
  const media = _deliveryNotificationToMobileMedia(msg);
  const key = media ? _mobileMediaKey(media) : '';
  const exists = __pmChat.threads[sid].some((item) => {
    if (text && _mobileMessageCopyText(item) === text) return true;
    if (!key) return false;
    return _collectMessageMedia(item).some((candidate) => _mobileMediaKey(candidate) === key);
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
  };
  if (media) _mergeMobileMediaIntoMessage(turn, [media]);
  __pmChat.threads[sid].push(turn);
  if (String(__pmChat.activeSessionId || '') === sid || location.hash.startsWith('#mobile/chat')) {
    __pmChat.activeSessionId = sid;
    _activeMobileThread();
    const threadEl = document.getElementById('pm-chat-thread');
    const bodyEl = document.getElementById('pm-chat-body');
    if (threadEl) _flushThreadRender(threadEl, bodyEl, sid);
  }
}

if (!window.__pmMobileDeliveryBridgeInstalled) {
  window.__pmMobileDeliveryBridgeInstalled = true;
  wsEventBus.on('delivery_notification', (msg = {}) => {
    const target = String(msg.target || '').toLowerCase();
    if (target && target !== 'mobile' && target !== 'all') return;
    _appendMobileDeliveryNotification(msg);
  });
}

function _renderMobileMediaGallery(mediaList) {
  const list = Array.isArray(mediaList) ? mediaList : [];
  if (!list.length) return '';
  return `<div class="pm-media-gallery">${list.map((media, idx) => {
    const src = _mobileMediaUrl(media, 'inline');
    const download = _mobileMediaUrl(media, 'download');
    const ext = _mobileFileExt(media.name || media.path).toUpperCase() || 'FILE';
    const meta = [media.provider, media.model, media.bytes ? _formatBytes(media.bytes) : ''].filter(Boolean).join(' · ');
    const attrs = `data-pm-media data-kind="${escapeHtml(media.kind)}" data-src="${escapeHtml(src)}" data-download="${escapeHtml(download)}" data-name="${escapeHtml(media.name)}" data-path="${escapeHtml(media.path || '')}" data-index="${idx}"`;
    if (media.kind === 'image') {
      return `<button type="button" class="pm-media-card image" ${attrs}><img src="${escapeHtml(src)}" alt="${escapeHtml(media.name)}" loading="lazy"><span><strong>${escapeHtml(media.name)}</strong>${meta ? `<em>${escapeHtml(meta)}</em>` : ''}</span></button>`;
    }
    if (media.kind === 'video') {
      return `<button type="button" class="pm-media-card video" ${attrs}><video src="${escapeHtml(src)}" muted playsinline preload="metadata"></video><span class="pm-media-play">${ICONS.play}</span><span><strong>${escapeHtml(media.name)}</strong>${meta ? `<em>${escapeHtml(meta)}</em>` : ''}</span></button>`;
    }
    return `<button type="button" class="pm-generated-file" ${attrs}><span class="pm-generated-file-icon">${ICONS.clipboard}</span><span class="pm-generated-file-info"><strong>${escapeHtml(media.name)}</strong><em>${escapeHtml(ext)} file${meta ? ` · ${escapeHtml(meta)}` : ''}</em></span></button>`;
  }).join('')}</div>`;
}

function _browseFileIcon(kind) {
  if (kind === 'image') return '🖼';
  if (kind === 'video') return '🎬';
  if (kind === 'audio') return '🎵';
  return '📄';
}

function _renderBrowseCard(bs) {
  if (bs.loading) {
    return `<div class="pm-browse-card"><div class="pm-browse-empty">Loading workspace files…</div></div>`;
  }
  if (bs.error) {
    return `<div class="pm-browse-card"><div class="pm-browse-error">⚠ ${escapeHtml(bs.error)}</div></div>`;
  }
  const parts = bs.cwd ? String(bs.cwd).split('/').filter(Boolean) : [];
  const crumbs = [{ label: '🏠 Workspace', path: '' }, ...parts.map((p, i) => ({ label: p, path: parts.slice(0, i + 1).join('/') }))];
  const breadcrumbHtml = crumbs.map((c, i) => {
    const isLast = i === crumbs.length - 1;
    return `<button type="button" class="pm-browse-crumb${isLast ? ' active' : ''}" data-browse-nav="${escapeHtml(c.path)}">${escapeHtml(c.label)}</button>${isLast ? '' : '<span class="pm-browse-sep">›</span>'}`;
  }).join('');
  const dirsHtml = bs.dirs.map(d => `
    <button type="button" class="pm-browse-item dir" data-browse-nav="${escapeHtml(d.path)}">
      <span class="pm-browse-item-icon">📁</span>
      <span class="pm-browse-item-name">${escapeHtml(d.name)}</span>
    </button>`).join('');
  const filesHtml = bs.files.map(f => `
    <button type="button" class="pm-browse-item file" data-browse-open="${escapeHtml(f.path)}" data-browse-kind="${escapeHtml(f.kind)}" data-browse-name="${escapeHtml(f.name)}">
      <span class="pm-browse-item-icon">${_browseFileIcon(f.kind)}</span>
      <span class="pm-browse-item-name">${escapeHtml(f.name)}</span>
    </button>`).join('');
  const emptyHtml = !bs.dirs.length && !bs.files.length ? '<div class="pm-browse-empty">Empty folder</div>' : '';
  return `
    <div class="pm-browse-card">
      <nav class="pm-browse-breadcrumb" aria-label="Path">${breadcrumbHtml}</nav>
      <div class="pm-browse-grid">${dirsHtml}${filesHtml}${emptyHtml}</div>
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
    finalAction: source.finalAction || fallback.finalAction || null,
    pathAccess: source.pathAccess || fallback.pathAccess || null,
    status: String(source.status || fallback.status || 'pending').toLowerCase(),
  };
}

function _renderMobileApprovalCard(approvalInput = {}, { compact = false } = {}) {
  const approval = _normalizeMobileApproval(approvalInput);
  if (!approval.id) return '';
  const human = _pmHumanApproval(approval);
  const technicalText = _pmApprovalTechnicalText(approval);
  const status = String(approval.status || 'pending').toLowerCase();
  const pending = status === 'pending';
  const risk = Number(approval.riskScore || 0);
  const statusLabel = status === 'rejected' ? 'denied' : status;
  const devPlan = approval?.devSourceEdit?.plan || null;
  const evidence = Array.isArray(devPlan?.evidence) ? devPlan.evidence : [];
  const steps = Array.isArray(devPlan?.steps) ? devPlan.steps : [];
  const boundary = approval.commandBoundary || null;
  const boundaryScope = String(boundary?.scope || '').trim();
  const boundaryPaths = Array.isArray(boundary?.externalPaths) ? boundary.externalPaths.filter(Boolean) : [];
  const expectedWorkflow = Array.isArray(devPlan?.expectedWorkflow)
    ? devPlan.expectedWorkflow
    : (Array.isArray(devPlan?.expected_workflow) ? devPlan.expected_workflow : []);
  return `<div class="pm-chat-approval ${pending ? 'pending' : 'resolved'} ${compact ? 'compact' : ''}" data-pm-approval-id="${escapeHtml(approval.id)}">
    <div class="pm-chat-approval-head">
      <span>${pending ? 'Approval needed' : 'Approval result'}</span>
      <b class="pm-chat-approval-status ${escapeHtml(statusLabel)}">${escapeHtml(statusLabel)}</b>
    </div>
    <strong>${escapeHtml(human.title || _pmApprovalTitle(approval))}</strong>
    ${human.summary ? `<p>${escapeHtml(human.summary)}</p>` : ''}
    ${human.detail ? `<em>${escapeHtml(human.detail)}</em>` : ''}
    ${risk ? `<small>Risk ${escapeHtml(String(risk))}</small>` : ''}
    ${boundaryScope && boundaryScope !== 'workspace' ? `<em>Boundary: ${escapeHtml(boundaryScope.replace(/_/g, ' '))}${boundary?.reason ? ` - ${escapeHtml(String(boundary.reason))}` : ''}</em>` : ''}
    ${boundaryPaths.length ? `<details class="pm-approval-technical" open><summary>External paths</summary><pre>${escapeHtml(boundaryPaths.slice(0, 8).join('\n'))}</pre></details>` : ''}
    ${devPlan?.reasoning ? `<em>${escapeHtml(String(devPlan.reasoning))}</em>` : ''}
    ${evidence.length ? `<details class="pm-approval-technical" open><summary>Evidence</summary><pre>${escapeHtml(evidence.slice(0, 5).map((item) => `${item.file || 'file'}${item.lines ? `:${item.lines}` : ''} - ${item.finding || ''}`).join('\n'))}</pre></details>` : ''}
    ${steps.length ? `<details class="pm-approval-technical"><summary>Plan</summary><pre>${escapeHtml(steps.slice(0, 8).map((step, idx) => `${idx + 1}. ${step}`).join('\n'))}</pre></details>` : ''}
    ${expectedWorkflow.length ? `<details class="pm-approval-technical" open><summary>Expected workflow after edits</summary><pre>${escapeHtml(expectedWorkflow.slice(0, 8).map((step, idx) => `${idx + 1}. ${step}`).join('\n'))}</pre></details>` : ''}
    ${technicalText ? `<details class="pm-approval-technical"><summary>Technical details</summary><pre>${escapeHtml(technicalText)}</pre></details>` : ''}
    ${_pmRenderCommandRunLink(approval)}
    ${pending ? `<div class="pm-chat-approval-actions">
      <button type="button" class="pm-chat-approval-btn approve" data-pm-approval-action="approve" data-pm-approval-id="${escapeHtml(approval.id)}">Approve</button>
      <button type="button" class="pm-chat-approval-btn reject" data-pm-approval-action="reject" data-pm-approval-id="${escapeHtml(approval.id)}">Reject</button>
      ${_pmIsCommandApproval(approval) ? `<button type="button" class="pm-chat-approval-btn session" data-pm-approval-action="approve_session" data-pm-approval-id="${escapeHtml(approval.id)}">Trust session</button>
      <button type="button" class="pm-chat-approval-btn always" data-pm-approval-action="approve_always" data-pm-approval-id="${escapeHtml(approval.id)}">Always allow</button>` : ''}
    </div>` : `<div class="pm-chat-approval-done">This request was ${escapeHtml(statusLabel)}.</div>`}
  </div>`;
}

function _getPendingApprovalsForSession(sessionId) {
  const sid = String(sessionId || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim();
  const list = Array.isArray(__pmChat.pendingApprovals?.[sid]) ? __pmChat.pendingApprovals[sid] : [];
  return list.filter((approval) => approval && approval.id && String(approval.status || 'pending') === 'pending');
}

function _upsertMobilePendingApproval(approvalInput = {}) {
  const approval = _normalizeMobileApproval(approvalInput);
  if (!approval.id) return false;
  const sid = approval.sessionId || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID;
  if (!__pmChat.pendingApprovals) __pmChat.pendingApprovals = {};
  const list = Array.isArray(__pmChat.pendingApprovals[sid]) ? __pmChat.pendingApprovals[sid] : [];
  const idx = list.findIndex((item) => String(item?.id || '') === approval.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...approval };
  else list.push(approval);
  __pmChat.pendingApprovals[sid] = list.slice(-8);
  return true;
}

function _updateMobilePendingApproval(id, patch = {}) {
  const approvalId = String(id || '').trim();
  if (!approvalId || !__pmChat.pendingApprovals) return null;
  for (const [sid, list] of Object.entries(__pmChat.pendingApprovals)) {
    const idx = Array.isArray(list) ? list.findIndex((item) => String(item?.id || '') === approvalId) : -1;
    if (idx < 0) continue;
    list[idx] = _normalizeMobileApproval({ ...list[idx], ...patch, id: approvalId });
    __pmChat.pendingApprovals[sid] = list;
    return list[idx];
  }
  return null;
}

function _renderMobileApprovalSheet() {
  const pending = Object.values(__pmChat.pendingApprovals || {})
    .flat()
    .filter((approval) => approval && approval.id && String(approval.status || 'pending') === 'pending');
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
  const current = pending.find((approval) => String(approval.sessionId || approval.sourceSessionId || '') === String(__pmChat.activeSessionId || '')) || pending[0];
  host.innerHTML = `<div class="pm-global-approval-backdrop"></div>
    <div class="pm-global-approval-sheet" role="dialog" aria-live="polite" aria-label="Approval required">
      ${_renderMobileApprovalCard(current)}
    </div>`;
  host.querySelectorAll('[data-pm-approval-action][data-pm-approval-id]').forEach((btn) => {
    btn.addEventListener('click', () => _resolveMobileApprovalButton(btn));
  });
  _wireMobileProcessRunActions(host);
}

async function _resolveMobileApprovalButton(button) {
  const id = String(button?.getAttribute?.('data-pm-approval-id') || '').trim();
  const action = String(button?.getAttribute?.('data-pm-approval-action') || '').trim();
  if (!id || !action) return;
  const approved = action === 'approve' || action === 'approve_session' || action === 'approve_always';
  const grantScope = action === 'approve_session' ? 'session' : action === 'approve_always' ? 'always' : '';
  const scope = button.closest('.pm-chat-approval, .pm-global-approval-sheet');
  scope?.querySelectorAll('button')?.forEach((btn) => { btn.disabled = true; });
  try {
    const result = approved ? await approveMobileApproval(id, grantScope) : await denyMobileApproval(id);
    const updated = _updateMobilePendingApproval(id, { status: approved ? 'approved' : 'rejected' });
    pmToast(approved ? (grantScope === 'always' ? 'Always allowed' : grantScope === 'session' ? 'Allowed this session' : 'Approved') : 'Rejected', approved ? 'success' : 'info');
    const sid = updated?.sessionId || updated?.sourceSessionId || __pmChat.activeSessionId;
    if (String(sid || '') === String(__pmChat.activeSessionId || '')) {
      const threadEl = document.getElementById('pm-chat-thread');
      const bodyEl = document.getElementById('pm-chat-body');
      if (threadEl) _flushThreadRender(threadEl, bodyEl, sid || 'chat');
    }
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
    scope?.querySelectorAll('button')?.forEach((btn) => { btn.disabled = false; });
    pmToast(`Approval failed: ${err.message || err}`, 'error');
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
    const sid = approval.sessionId || approval.sourceSessionId || '';
    if (String(sid) === String(__pmChat.activeSessionId || '')) {
      const threadEl = document.getElementById('pm-chat-thread');
      const bodyEl = document.getElementById('pm-chat-body');
      if (threadEl) _flushThreadRender(threadEl, bodyEl, sid || 'chat');
    }

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
      const sid = updated?.sessionId || updated?.sourceSessionId || msg.sessionId || '';
      if (String(sid) === String(__pmChat.activeSessionId || '')) {
        const threadEl = document.getElementById('pm-chat-thread');
        const bodyEl = document.getElementById('pm-chat-body');
        if (threadEl) _flushThreadRender(threadEl, bodyEl, sid || 'chat');
      }

    });
  });
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
  const secondary = isUser
    ? `<button type="button" class="pm-msg-action" data-msg-action="edit" data-msg-index="${index}" title="Edit" aria-label="Edit">${ICONS.wand}</button>`
    : `<button type="button" class="pm-msg-action" data-msg-action="fork" data-msg-index="${index}" title="Fork" aria-label="Fork">${ICONS.fork || ICONS.chev}</button>`;
  return `<div class="pm-msg-actions">
    <button type="button" class="pm-msg-action" data-msg-action="copy" data-msg-index="${index}" title="Copy" aria-label="Copy">${ICONS.clipboard}</button>
    ${secondary}
    ${isUser ? _renderMobileVariantNav(index) : ''}
  </div>`;
}

function _renderMobileUserEditComposer(m, index, attachmentHtml = '') {
  const value = escapeHtml(String(m?._editingDraft ?? m?.body?.text ?? m?.content ?? ''));
  return `<div class="pm-mobile-edit-composer" data-msg-edit-index="${index}" onclick="event.stopPropagation()">
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
    const statusRaw = String(file?.status || 'modified').toLowerCase();
    const status = ['added', 'modified', 'deleted', 'renamed'].includes(statusRaw) ? statusRaw : 'modified';
    return {
      path,
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
  };
}

function _renderMobileFileChangeRow(file) {
  const canOpen = file.path && file.status !== 'deleted';
  const kind = _mobileMediaKind({ path: file.path, name: file.displayPath });
  return `
    <div class="pm-file-change-row ${canOpen ? 'is-openable' : 'is-disabled'}"
      ${canOpen ? `data-pm-file-change-path="${escapeHtml(file.path)}" data-pm-file-change-name="${escapeHtml(file.displayPath.split(/[\\/]/).pop() || file.displayPath || 'file')}" data-pm-file-change-kind="${escapeHtml(kind)}"` : 'aria-disabled="true"'}>
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

function _renderMobileFileChanges(fileChanges) {
  const data = _normalizeMobileFileChanges(fileChanges);
  if (!data) return '';
  const visible = data.files.slice(0, 3);
  const rest = data.files.slice(3);
  const fileWord = data.summary.fileCount === 1 ? 'file' : 'files';
  return `
    <div class="pm-file-changes-card">
      <div class="pm-file-changes-head">
        <strong>${data.summary.fileCount} ${fileWord} changed</strong>
        <span><em class="ins">+${data.summary.insertions}</em><em class="del">-${data.summary.deletions}</em></span>
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
  const readonly = sent ? ' readonly' : '';
  const disabled = sent ? ' disabled' : '';
  const open = sent ? '' : ' open';
  const title = sent ? 'Email sent' : 'Email draft';
  const to = _mobileEmailList(a.to).join(', ');
  const cc = _mobileEmailList(a.cc).join(', ');
  const bcc = _mobileEmailList(a.bcc).join(', ');
  const subject = String(a.subject || '').trim();
  const body = String(a.body || '').trim();
  const attachments = Array.isArray(a.attachments) ? a.attachments.filter(Boolean) : [];
  const sentMeta = [
    a.sentAt ? new Date(a.sentAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '',
    a.messageId ? `Message ${String(a.messageId).slice(0, 18)}` : '',
  ].filter(Boolean).join(' · ');
  return `<details class="pm-email-composer-card ${sent ? 'is-sent' : 'is-draft'}" data-email-composer-id="${escapeHtml(id)}"${open}>
    <summary class="pm-email-composer-summary">
      <span class="pm-email-composer-dot">${sent ? '✓' : '✉'}</span>
      <span><strong>${escapeHtml(title)}</strong><em>${escapeHtml(subject || '(no subject)')}</em>${sentMeta ? `<small>${escapeHtml(sentMeta)}</small>` : ''}</span>
    </summary>
    <div class="pm-email-composer-panel">
      <label class="pm-email-composer-field"><span>To</span><input type="text" data-email-field="to" value="${escapeHtml(to)}"${readonly} autocomplete="off"></label>
      <div class="pm-email-composer-two">
        <label class="pm-email-composer-field"><span>Cc</span><input type="text" data-email-field="cc" value="${escapeHtml(cc)}"${readonly} autocomplete="off"></label>
        <label class="pm-email-composer-field"><span>Bcc</span><input type="text" data-email-field="bcc" value="${escapeHtml(bcc)}"${readonly} autocomplete="off"></label>
      </div>
      <label class="pm-email-composer-field"><span>Subject</span><input type="text" data-email-field="subject" value="${escapeHtml(subject)}"${readonly} autocomplete="off"></label>
      <textarea class="pm-email-composer-body" data-email-field="body" rows="9"${readonly}>${escapeHtml(body)}</textarea>
      ${attachments.length ? `<div class="pm-email-composer-attachments">${attachments.map((att) => {
        const name = String(att?.name || att?.filename || 'Attachment').trim();
        const size = att?.size ? ` · ${_formatBytes(Number(att.size) || 0)}` : '';
        return `<span>${ICONS.paperclip}${escapeHtml(name)}${escapeHtml(size)}</span>`;
      }).join('')}</div>` : ''}
      <div class="pm-email-composer-actions">
        ${sent ? `<span class="pm-email-composer-sent">Sent from Gmail</span>` : `<button type="button" class="pm-email-composer-send" data-email-composer-action="send">${ICONS.send}<span>Send</span></button>`}
        <button type="button" class="pm-email-composer-tool" data-email-composer-action="format" title="Format">Aa</button>
        <button type="button" class="pm-email-composer-tool" data-email-composer-action="emoji" title="Emoji">☺</button>
        <button type="button" class="pm-email-composer-tool" data-email-composer-action="attach" title="Attach">${ICONS.paperclip}</button>
        <button type="button" class="pm-email-composer-tool" data-email-composer-action="image" title="Insert image">${ICONS.image}</button>
        <button type="button" class="pm-email-composer-tool danger" data-email-composer-action="discard" title="Discard"${disabled}>${ICONS.trash}</button>
      </div>
    </div>
  </details>`;
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
  if (!loc && !daily.length) return '';
  const days = daily.map((d) => `
    <div class="pm-wx-day">
      <div class="pm-wx-day-name">${escapeHtml(String(d.day || ''))}</div>
      <div class="pm-wx-day-icon">${escapeHtml(String(d.icon || '🌡️'))}</div>
      <div class="pm-wx-day-hi">${d.high != null ? escapeHtml(String(d.high)) + '°' : ''}</div>
      <div class="pm-wx-day-lo">${d.low != null ? escapeHtml(String(d.low)) + '°' : ''}</div>
    </div>`).join('');
  return `<div class="pm-weather">
    <div class="pm-wx-head">
      <div class="pm-wx-loc">${escapeHtml(loc)}</div>
      <div class="pm-wx-now">${cur.temp != null ? escapeHtml(String(cur.temp)) + '°' + escapeHtml(unit) : ''}</div>
      <div class="pm-wx-cond">${escapeHtml(String(cur.icon || ''))} ${escapeHtml(String(cur.condition || ''))}</div>
    </div>
    ${days ? `<div class="pm-wx-days">${days}</div>` : ''}
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

const PM_CHART_COLORS = ['#5a91ff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'];
function _renderMobileChart(a) {
  const series = Array.isArray(a?.series) ? a.series.filter((s) => s && Array.isArray(s.points) && s.points.length) : [];
  if (!series.length) return '';
  const title = String(a?.title || '').trim();
  const type = ['line', 'bar', 'area'].includes(a?.chartType) ? a.chartType : 'line';
  const W = 320, H = 150, pad = 8;
  const allY = series.flatMap((s) => s.points.map((p) => Number(p.y)).filter((n) => Number.isFinite(n)));
  const minY = Math.min(0, ...allY), maxY = Math.max(...allY), rangeY = (maxY - minY) || 1;
  const maxLen = Math.max(...series.map((s) => s.points.length));
  const innerW = W - pad * 2, innerH = H - pad * 2;
  const xAt = (i) => pad + (maxLen <= 1 ? innerW / 2 : (i / (maxLen - 1)) * innerW);
  const yAt = (y) => pad + innerH - ((Number(y) - minY) / rangeY) * innerH;
  let body = '';
  if (type === 'bar') {
    const groupW = innerW / maxLen;
    const barW = Math.max(2, (groupW / series.length) * 0.7);
    series.forEach((s, si) => {
      const color = s.color || PM_CHART_COLORS[si % PM_CHART_COLORS.length];
      s.points.forEach((p, i) => {
        const x = pad + i * groupW + si * (groupW / series.length);
        const y = yAt(p.y), y0 = yAt(0);
        body += `<rect x="${x.toFixed(1)}" y="${Math.min(y, y0).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.abs(y0 - y).toFixed(1)}" fill="${color}" rx="1.5"/>`;
      });
    });
  } else {
    series.forEach((s, si) => {
      const color = s.color || PM_CHART_COLORS[si % PM_CHART_COLORS.length];
      const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p.y).toFixed(1)}`).join(' ');
      if (type === 'area') body += `<path d="${d} L${xAt(s.points.length - 1).toFixed(1)},${yAt(minY).toFixed(1)} L${xAt(0).toFixed(1)},${yAt(minY).toFixed(1)} Z" fill="${color}" opacity="0.14"/>`;
      body += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
    });
  }
  const legend = (series.length > 1 || series[0].label)
    ? `<div class="pm-chart-legend">${series.map((s, si) => `<span><i style="background:${s.color || PM_CHART_COLORS[si % PM_CHART_COLORS.length]}"></i>${escapeHtml(String(s.label || `Series ${si + 1}`))}</span>`).join('')}</div>`
    : '';
  return `<div class="pm-chart">${title ? `<div class="pm-chart-heading">${escapeHtml(title)}</div>` : ''}<svg class="pm-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${body}</svg>${legend}</div>`;
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

function _renderMobileMap(a) {
  if (!a || typeof a !== 'object') return '';
  const markers = Array.isArray(a.markers) ? a.markers : [];
  if (!markers.length) return '';
  const title = String(a.title || '').trim();
  const located = markers.filter((m) => Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng)));
  const c = a.center || located[0] || {};
  const lat = Number(c.lat), lng = Number(c.lng);
  const span = 0.06;
  const src = Number.isFinite(lat) ? `https://www.openstreetmap.org/export/embed.html?bbox=${lng - span},${lat - span},${lng + span},${lat + span}&layer=mapnik${located[0] ? `&marker=${located[0].lat},${located[0].lng}` : ''}` : '';
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
  return `<div class="pm-map">${title ? `<div class="pm-map-heading">${escapeHtml(title)}</div>` : ''}${src ? `<div class="pm-map-frame-wrap"><iframe class="pm-map-frame" src="${escapeHtml(src)}" loading="lazy"></iframe></div>` : ''}<div class="pm-map-markers">${list}</div></div>`;
}

function _renderMobileSources(a) {
  const items = Array.isArray(a?.items) ? a.items.filter(Boolean) : [];
  if (!items.length) return '';
  const title = String(a?.title || '').trim();
  const cards = items.map((it) => {
    const url = String(it.url || '').trim();
    const img = String(it.imageUrl || '').trim();
    const publisher = String(it.publisher || '').trim();
    const headline = String(it.title || url || 'Source').trim();
    const date = String(it.publishedAt || '').trim();
    const inner = `
      ${img ? `<div class="pm-src-img-wrap"><img class="pm-src-img" src="${escapeHtml(img)}" alt="" loading="lazy"></div>` : ''}
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

function _renderChatMessageHtml(m, index = -1) {
  const msgIndex = Number.isFinite(Number(index)) ? Number(index) : -1;
  const attachments = Array.isArray(m.body?.attachments) ? m.body.attachments : [];
  const attachmentHtml = attachments.length ? _renderChatAttachmentPreviews(attachments, false) : '';
  const revealTime = m.time ? `<span class="pm-reveal-time" aria-hidden="true">${escapeHtml(m.time)}</span>` : '';
  if (m.role === 'user') {
    const isWorkerHandoff = _isMobileVoiceAgentWorkerHandoff(m);
    const bodyHtml = __pmChat.editingMessageIndex === msgIndex
      ? _renderMobileUserEditComposer(m, msgIndex, attachmentHtml)
      : `${isWorkerHandoff ? '<span class="pm-sender pm-handoff-sender">Voice Agent to Worker</span>' : ''}<div class="markdown-body">${_renderMobileMarkdown(m.body.text)}</div>${attachmentHtml}`;
    return `<div class="pm-msg from-user${isWorkerHandoff ? ' voice-worker-handoff' : ''}${m.workflowGroupId ? ' workflow-linked' : ''}${m.workflowPart ? ` workflow-${escapeHtml(String(m.workflowPart))}` : ''}" data-msg-index="${msgIndex}">
      ${m.workflowLabel && !isWorkerHandoff ? `<div class="pm-workflow-chip">${escapeHtml(m.workflowLabel)}</div>` : ''}
      <div class="pm-bubble">${bodyHtml}</div>${_renderMobileMessageActions(m, msgIndex)}${revealTime}</div>`;
  }
  const b = m.body || {};
  let inner = _renderMobileWorkTimer(m);
  if (m.approvalRequest) {
    inner += _renderMobileApprovalCard(m.approvalRequest, { compact: false });
  }
  const answerStarted = !!(m.finalResponseStarted || String(b.text || m.content || '').trim());
  const hasLiveTrace = m.streaming && !answerStarted && Array.isArray(m.liveTraceEntries) && m.liveTraceEntries.length;
  if (hasLiveTrace) {
    inner += _renderMobileLiveTrace(m.liveTraceEntries);
  } else if (m.streaming && !answerStarted) {
    inner += '<div class="pm-thinking-dots"><span></span><span></span><span></span></div>';
  }
  if (b.text) {
    inner += `<div class="markdown-body">${_renderMobileMarkdown(b.text)}</div>`;
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
  const activeApprovals = m.streaming ? _getPendingApprovalsForSession(__pmChat.activeSessionId) : [];
  if (activeApprovals.length) {
    inner += `<div class="pm-chat-approvals-inline">${activeApprovals.map((approval) => _renderMobileApprovalCard(approval, { compact: true })).join('')}</div>`;
  }
  if (b.browseState) inner += _renderBrowseCard(b.browseState);
  inner += _renderMobileRichArtifacts(m);
  if (!(Array.isArray(m.richArtifacts) && m.richArtifacts.some((a) => a?.type === 'products'))) {
    inner += _renderMobileProductCarousel(m);
  }
  inner += _renderMobileMediaGallery(_collectMessageMedia(m));
  inner += _renderMobileFileChanges(m.fileChanges);
  inner += _renderMobileProcess(_mobileProcessEntriesWithLiveTrace(m, m.processEntries || b.processEntries), { collapsed: m.streaming && answerStarted });
  return `<div class="pm-msg from-ai${m.workflowGroupId ? ' workflow-linked' : ''}${m.workflowPart ? ` workflow-${escapeHtml(String(m.workflowPart))}` : ''}" data-msg-index="${msgIndex}"${m.streaming ? ' data-streaming="1"' : ''}>
    ${m.workflowLabel ? `<div class="pm-workflow-chip">${escapeHtml(m.workflowLabel)}</div>` : ''}
    <div class="pm-bubble">${inner}</div>${_renderMobileMessageActions(m, msgIndex)}${revealTime}</div>`;
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

function _collectMediaFromToolEvent(message, evt) {
  const extra = evt?.extra && typeof evt.extra === 'object' ? evt.extra : {};
  let result = evt?.result && typeof evt.result === 'object' ? evt.result : {};
  if ((!result || !Object.keys(result).length) && typeof evt?.result === 'string') {
    try {
      const parsed = JSON.parse(evt.result);
      if (parsed && typeof parsed === 'object') result = parsed;
    } catch {}
  }
  const sources = [extra, result, evt].filter(Boolean);
  for (const source of sources) {
    if (Array.isArray(source.generated_images)) _addMobileMedia(message, 'generatedImages', source.generated_images, 'image');
    if (Array.isArray(source.generatedImages)) _addMobileMedia(message, 'generatedImages', source.generatedImages, 'image');
    if (source.generated_image) _addMobileMedia(message, 'generatedImages', source.generated_image, 'image');
    if (source.generatedImage) _addMobileMedia(message, 'generatedImages', source.generatedImage, 'image');
    if (Array.isArray(source.images)) _addMobileMedia(message, 'generatedImages', source.images, 'image');
    if (source.image && typeof source.image === 'object' && (source.image.path || source.image.rel_path || source.image.base64)) _addMobileMedia(message, 'generatedImages', source.image, 'image');
    if (Array.isArray(source.generated_videos)) _addMobileMedia(message, 'generatedVideos', source.generated_videos, 'video');
    if (Array.isArray(source.generatedVideos)) _addMobileMedia(message, 'generatedVideos', source.generatedVideos, 'video');
    if (source.generated_video) _addMobileMedia(message, 'generatedVideos', source.generated_video, 'video');
    if (source.generatedVideo) _addMobileMedia(message, 'generatedVideos', source.generatedVideo, 'video');
    if (Array.isArray(source.videos)) _addMobileMedia(message, 'generatedVideos', source.videos, 'video');
    if (source.video && typeof source.video === 'object' && (source.video.path || source.video.rel_path || source.video.url)) _addMobileMedia(message, 'generatedVideos', source.video, 'video');
    if (Array.isArray(source.canvasFiles)) _mergeMobileMediaIntoMessage(message, source.canvasFiles.map((path) => ({ path })));
    if (Array.isArray(source.files)) _mergeMobileMediaIntoMessage(message, source.files);
    if (Array.isArray(source.artifacts)) _mergeMobileMediaIntoMessage(message, source.artifacts);
    if (source.productCarousel && typeof source.productCarousel === 'object') _mergeMobileProductCarouselIntoMessage(message, source.productCarousel);
    if (Array.isArray(source.results)) {
      for (const nested of source.results) _collectMediaFromToolEvent(message, nested);
    }
  }
}

function _renderChatAttachmentPreviews(files, removable = true) {
  const items = (Array.isArray(files) ? files : []).map((f, i) => {
    const name = escapeHtml(f.name || 'Attachment');
    const meta = escapeHtml(f.sizeLabel || f.mimeType || 'file');
    const remove = removable ? `<button type="button" class="pm-attach-remove" data-remove-attachment="${i}" aria-label="Remove attachment">×</button>` : '';
    if (f.kind === 'image' && (f.dataUrl || f.workspacePath)) {
      const src = f.dataUrl || `/api/canvas/inline?path=${encodeURIComponent(String(f.workspacePath || ''))}`;
      return `<div class="pm-attach-chip image">${remove}<img src="${escapeHtml(src)}" alt=""><span><strong>${name}</strong><em>${meta}</em></span></div>`;
    }
    if (f.kind === 'video' && (f.dataUrl || f.workspacePath)) {
      const src = f.dataUrl || `/api/canvas/inline?path=${encodeURIComponent(String(f.workspacePath || ''))}`;
      return `<div class="pm-attach-chip video">${remove}<video src="${escapeHtml(src)}" muted playsinline preload="metadata"></video><span><strong>${name}</strong><em>${meta}</em></span></div>`;
    }
    return `<div class="pm-attach-chip">${remove}<span class="pm-attach-file">${ICONS.clipboard}</span><span><strong>${name}</strong><em>${meta}</em></span></div>`;
  }).join('');
  return items ? `<div class="pm-attach-list">${items}</div>` : '';
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

async function _uploadMobileChatAttachments(files = []) {
  const list = Array.isArray(files) ? files : [];
  const results = [];
  for (const f of list) {
    const filename = f.name || 'attachment';
    const ext = _mobileFileExt(filename);
    try {
      if (f.kind === 'text' && f.text != null) {
        const r = await uploadMobileTextFile({ filename, content: String(f.text || '') });
        const workspacePath = r?.absPath || r?.path || '';
        f.workspacePath = workspacePath;
        results.push({ name: filename, ext, workspacePath, relPath: r?.relPath || '' });
      } else {
        const base64 = f.base64 || await _readMobileFileBase64(f.file);
        const mimeType = f.mimeType || 'application/octet-stream';
        const r = await uploadMobileBinaryFile({ filename, base64, mimeType });
        const workspacePath = r?.absPath || r?.path || '';
        f.workspacePath = workspacePath;
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
      results.push({
        name: filename,
        ext,
        workspacePath: '',
        isImage: f.kind === 'image',
        isVideo: f.kind === 'video',
        binary: f.kind !== 'text',
        mimeType: f.mimeType || '',
        error: err?.message || String(err || 'Upload failed'),
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

function _renderThread(threadEl) {
  _dedupeMobileAssistantTurns(__pmChat.thread);
  _reindexMobileThread(__pmChat.thread);
  // Preserve which process-log <details> the user has opened, plus their inner
  // scroll, across this full innerHTML rebuild — otherwise streaming re-renders
  // snap the process log closed and reset its scroll every tick.
  const openProc = {};
  try {
    threadEl.querySelectorAll('details.pm-process-stream[open]').forEach((d) => {
      const idx = d.closest('[data-msg-index]')?.getAttribute('data-msg-index');
      if (idx == null) return;
      const full = d.querySelector('.pm-process-full');
      openProc[idx] = { scrollTop: full ? full.scrollTop : 0 };
    });
  } catch {}
  threadEl.innerHTML = __pmChat.thread
    .map((msg, index) => _isMobileHiddenVoiceDraftMessage(msg, index) ? '' : _renderChatMessageHtml(msg, index))
    .join('');
  try {
    Object.keys(openProc).forEach((idx) => {
      const msgEl = threadEl.querySelector(`[data-msg-index="${idx}"]`);
      const d = msgEl?.querySelector('details.pm-process-stream');
      if (!d) return;
      d.setAttribute('open', '');
      const full = d.querySelector('.pm-process-full');
      if (full) full.scrollTop = openProc[idx].scrollTop;
    });
  } catch {}
  threadEl.querySelectorAll('[data-pm-approval-action][data-pm-approval-id]').forEach((btn) => {
    btn.addEventListener('click', () => _resolveMobileApprovalButton(btn));
  });
  _wireMobileProcessRunActions(threadEl);
  _wireMobileMediaCards(threadEl);
  _wireMobileFileChangeRows(threadEl);
}

function _syncMobileWorkTimer(threadEl, bodyEl, key = 'chat') {
  const hasStreamingAssistant = _activeMobileThread().some((msg) => _isMobileAssistantMessage(msg) && msg.streaming === true);
  if (hasStreamingAssistant) {
    if (!__pmChat.workTimer) {
      __pmChat.workTimer = setInterval(() => {
        const activeThreadEl = document.getElementById('pm-chat-thread') || threadEl;
        const activeBodyEl = document.getElementById('pm-chat-body') || bodyEl;
        if (!activeThreadEl) return;
        _flushThreadRender(activeThreadEl, activeBodyEl, key);
      }, 1000);
    }
  } else if (__pmChat.workTimer) {
    clearInterval(__pmChat.workTimer);
    __pmChat.workTimer = null;
  }
}

function _installMobileTimestampReveal(threadEl) {
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

  const isInteractiveTarget = (target) => !!target?.closest?.(
    'button,a,input,textarea,select,summary,details,[data-msg-action],[data-pm-command-action],[data-pm-file-change-path],.pm-media-card,.pm-generated-file,.pm-product-carousel,.pm-product-track,.pm-product-card'
  );

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
}

function _mobileChatScrollSnapshot(bodyEl, threshold = 72) {
  if (!bodyEl) return { nearBottom: true, distanceFromBottom: 0 };
  const distanceFromBottom = Math.max(0, bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight);
  return {
    nearBottom: distanceFromBottom <= threshold,
    distanceFromBottom,
  };
}

function _withMobileInstantScroll(bodyEl, fn) {
  if (!bodyEl || typeof fn !== 'function') return;
  const previous = bodyEl.style.scrollBehavior;
  bodyEl.style.scrollBehavior = 'auto';
  try {
    fn();
  } finally {
    requestAnimationFrame(() => {
      if (bodyEl) bodyEl.style.scrollBehavior = previous;
    });
  }
}

function _restoreMobileChatScroll(bodyEl, snapshot, { forceBottom = false } = {}) {
  if (!bodyEl) return;
  const snap = snapshot || _mobileChatScrollSnapshot(bodyEl);
  const followBottom = forceBottom || snap.nearBottom;
  const apply = () => {
    if (followBottom) {
      bodyEl.scrollTop = bodyEl.scrollHeight;
    } else {
      const nextTop = bodyEl.scrollHeight - bodyEl.clientHeight - Number(snap.distanceFromBottom || 0);
      bodyEl.scrollTop = Math.max(0, nextTop);
    }
  };
  _withMobileInstantScroll(bodyEl, apply);
  requestAnimationFrame(() => _withMobileInstantScroll(bodyEl, apply));
}

function _scheduleThreadRender(threadEl, bodyEl, key = 'chat', delay = 90) {
  if (!threadEl) return;
  const timerKey = String(key || 'chat');
  if (__pmChat.renderTimers?.[timerKey]) return;
  __pmChat.renderTimers[timerKey] = setTimeout(() => {
    delete __pmChat.renderTimers[timerKey];
    const scrollSnapshot = _mobileChatScrollSnapshot(bodyEl);
    _renderThread(threadEl);
    _restoreMobileChatScroll(bodyEl, scrollSnapshot);
  }, Math.max(16, Number(delay) || 90));
}

function _flushThreadRender(threadEl, bodyEl, key = 'chat', options = {}) {
  const timerKey = String(key || 'chat');
  if (__pmChat.renderTimers?.[timerKey]) {
    clearTimeout(__pmChat.renderTimers[timerKey]);
    delete __pmChat.renderTimers[timerKey];
  }
  const scrollSnapshot = _mobileChatScrollSnapshot(bodyEl);
  _renderThread(threadEl);
  _syncMobileWorkTimer(threadEl, bodyEl, timerKey);
  _restoreMobileChatScroll(bodyEl, scrollSnapshot, options);
}

function _renderMobileChatSessionNow(sessionId) {
  const sid = String(sessionId || '').trim();
  const thread = sid ? __pmChat.threads?.[sid] : null;
  if (sid && Array.isArray(thread)) {
    __pmChat.activeSessionId = sid;
    __pmChat.thread = thread;
  } else {
    _activeMobileThread();
  }
  const threadEl = document.getElementById('pm-chat-thread');
  const bodyEl = document.getElementById('pm-chat-body');
  if (threadEl) _flushThreadRender(threadEl, bodyEl, sid || __pmChat.activeSessionId || 'chat');
}

function _scrollChat(bodyEl) {
  if (!bodyEl) return;
  _restoreMobileChatScroll(bodyEl, null, { forceBottom: true });
}

const PM_CHAT_SLASH_COMMANDS = [
  { command: '/side', label: 'Open a linked side chat', placeholder: 'Optional first side-chat message...' },
  { command: '/goal', label: 'Start goal mode in this chat', placeholder: 'Describe the goal Prometheus should keep working toward...' },
  { command: '/goal status', label: 'Show the active goal state', placeholder: 'Optional note for the status check...' },
  { command: '/goal pause', label: 'Pause the active goal runner', placeholder: 'Optional reason...' },
  { command: '/goal resume', label: 'Resume a paused goal', placeholder: 'Optional note before resuming...' },
  { command: '/goal done', label: 'Mark the goal completed', placeholder: 'Optional completion note...' },
  { command: '/goal clear', label: 'Stop and archive the goal', placeholder: 'Optional archive note...' },
  { command: '/goal revise', label: 'Rewrite the active goal', placeholder: 'Write the revised goal...' },
  { command: '/models', label: 'Open provider and model controls', placeholder: 'Use without extra text to open model settings...' },
  { command: '/new', label: 'Start a fresh chat', placeholder: 'Use without extra text to open a new chat...' },
  { command: '/screenshot', label: 'Open screenshot controls', placeholder: 'Use without extra text for screenshot options...' },
  { command: '/restart', label: 'Open gateway restart controls', placeholder: 'Use without extra text for quick/full restart...' },
  { command: '/stop', label: 'Inspect and stop live AI flows', placeholder: 'Use without extra text to show live flows...' },
  { command: '/stop_now', label: 'Stop the active main chat turn', placeholder: 'Use without extra text to abort this chat...' },
  { command: '/browse', label: 'Browse workspace files', placeholder: 'Optional path to start in, e.g. src/gateway' },
];

let pmActiveSlashCommand = null;
let pmSlashCommandSelectionIndex = 0;
let pmSkillTriggerExpanded = false;
let pmSkillTriggerSelectedId = '';
let pmSkillTriggerLastKey = '';

const PM_SKILL_TRIGGER_STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'and', 'or', 'with', 'in', 'on', 'at',
  'me', 'my', 'our', 'this', 'that', 'please',
]);

function _pmNormalizeSkillText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _pmNormalizeSkillTextLoose(value) {
  return _pmNormalizeSkillText(value)
    .split(' ')
    .filter((word) => word && !PM_SKILL_TRIGGER_STOPWORDS.has(word))
    .join(' ');
}

function _pmSkillTriggerMatchesText(trigger, rawText, words) {
  const normalizedTrigger = _pmNormalizeSkillText(trigger);
  if (!normalizedTrigger) return false;
  const normalizedText = _pmNormalizeSkillText(rawText);
  if (normalizedTrigger.includes(' ')) {
    if (normalizedText.includes(normalizedTrigger)) return true;
    const looseTrigger = _pmNormalizeSkillTextLoose(trigger);
    const looseText = _pmNormalizeSkillTextLoose(rawText);
    return looseTrigger.length >= 4 && looseText.includes(looseTrigger);
  }
  return words.some((word) => {
    const normalizedWord = _pmNormalizeSkillText(word);
    if (normalizedWord === normalizedTrigger) return true;
    if (normalizedTrigger.length < 5 || normalizedWord.length < 5) return false;
    return normalizedWord.startsWith(normalizedTrigger) || normalizedTrigger.startsWith(normalizedWord);
  });
}

function _pmComposerSkillMatches(value) {
  const text = String(value || '').toLowerCase();
  if (!text.trim()) return [];
  const words = text.split(/\W+/).filter((word) => word.length > 2);
  return (Array.isArray(window.prometheusSkillsCache) ? window.prometheusSkillsCache : [])
    .filter((skill) => Array.isArray(skill?.triggers) && skill.triggers.length)
    .filter((skill) => skill.triggers.some((trigger) => _pmSkillTriggerMatchesText(trigger, text, words)))
    .slice(0, 8);
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

function _pmRenderSkillTriggerPill(page, input) {
  const pill = page?.querySelector?.('#pm-skill-trigger-pill');
  if (!pill) return;
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
            ${escapeHtml(skill.name || skill.id || 'Skill')}
          </button>
        `).join('')}
      </div>
      <div class="pm-skill-trigger-desc">
        ${selectedSkill ? `
          <strong>${escapeHtml(selectedSkill.name || selectedSkill.id || 'Skill')}</strong>
          <span>${escapeHtml(selectedSkill.description || 'No description available.')}</span>
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
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      pmSkillTriggerExpanded = true;
      pmSkillTriggerSelectedId = button.getAttribute('data-skill-id') || '';
      _pmRenderSkillTriggerPill(page, input);
    });
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

function _pmSlashCommandSuggestions(value) {
  const text = String(value || '');
  if (!text.startsWith('/') || /\s/.test(text.trim())) return [];
  const query = text.toLowerCase();
  return PM_CHAT_SLASH_COMMANDS.filter((item) => item.command.toLowerCase().startsWith(query)).slice(0, 7);
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
    input.placeholder = 'Type a message...';
    return;
  }
  chip.hidden = false;
  chip.querySelector('.pm-command-chip-token').textContent = pmActiveSlashCommand.command;
  input.placeholder = pmActiveSlashCommand.placeholder || 'Type the command details...';
}

function _pmSetActiveSlashCommand(page, input, item, remainder = '') {
  if (!input || !item) return;
  pmActiveSlashCommand = item;
  input.value = String(remainder || '');
  _pmRefreshSlashChrome(page, input);
  _pmHideSlashPopover(page);
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
  const current = String(input?.value || '');
  const typedMatch = _pmMatchSlashCommandValue(current);
  const remainder = typedMatch?.item.command === item.command ? typedMatch.remainder : '';
  _pmSetActiveSlashCommand(page, input, item, remainder);
}

function _pmRenderSlashPopover(page, input) {
  const popover = page.querySelector('#pm-chat-slash-popover');
  if (!popover || pmActiveSlashCommand) {
    _pmHideSlashPopover(page);
    return [];
  }
  const suggestions = _pmSlashCommandSuggestions(input?.value || '');
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
    btn.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      _pmSelectSlashCommand(page, input, btn.getAttribute('data-command') || '');
    });
  });
  popover.hidden = false;
  return suggestions;
}

function _pmHandleSlashInput(page, input) {
  const value = String(input?.value || '');
  if (pmActiveSlashCommand) {
    if (value.startsWith('/')) {
      pmActiveSlashCommand = null;
      _pmRefreshSlashChrome(page, input);
      pmSlashCommandSelectionIndex = 0;
      _pmRenderSlashPopover(page, input);
    }
    return;
  }
  const match = _pmMatchSlashCommandValue(value);
  if (match) {
    _pmSetActiveSlashCommand(page, input, match.item, match.remainder);
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

function _openMobileMediaTarget({ kind, src, download, name, path }) {
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
    });
    return;
  }
  if (['image', 'video', 'audio'].includes(safeKind)) {
    _openMobileMediaViewer({ kind: safeKind, src: mediaSrc, download, name: title });
  }
}

function _wireMobileMediaCards(root = document) {
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
        src: path ? _mobileMediaUrl({ path }, 'inline') : '',
        download: path ? _mobileMediaUrl({ path }, 'download') : '',
      });
    });
  });
}

export function renderChatPage(page, { navigate, sessionId = null }) {
  _installMobileApprovalBridge();
  // When the Chat tab is opened without a session in the URL, return to the last
  // chat the user explicitly opened. New Chat clears this key, so notifications
  // cannot hijack an intentional blank draft.
  const rememberedSession = sessionId ? '' : _readMobileLastChatSession();
  let requestedSession = String(sessionId || rememberedSession || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
  if (requestedSession !== MOBILE_CHAT_SESSION_ID) _rememberMobileLastChatSession(requestedSession);
  __pmChat.activeSessionId = requestedSession;
  if (!__pmChat.activeRuns || typeof __pmChat.activeRuns !== 'object') __pmChat.activeRuns = {};
  _activeMobileThread();
  const header = renderMobileHeader({
    title: requestedSession === MOBILE_CHAT_SESSION_ID ? 'New Chat' : 'Chat',
    online: true,
    hideTitle: true,
    hideBrand: true,
    rightActions: `<button class="pm-icon-btn" data-action="new-chat" aria-label="New chat">${ICONS.plus}</button>`,
  });
  page.innerHTML = `
    ${header}
    <div class="pm-body pm-chat-body" id="pm-chat-body">
      <div class="pm-chat-thread" id="pm-chat-thread"></div>
    </div>
    <div class="pm-mobile-queued-prompts" id="pm-mobile-queued-prompts" hidden></div>
    <form class="pm-composer" id="pm-composer">
      <input id="pm-file-input" type="file" multiple accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.avi,.mkv,.txt,.md,.json,.csv,.tsv,.log,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.yaml,.yml,application/pdf" hidden />
      <div class="pm-chat-slash-popover" id="pm-chat-slash-popover" hidden></div>
      <div class="pm-skill-trigger-pill" id="pm-skill-trigger-pill" hidden aria-live="polite"></div>
      <div class="pm-attach-tray" id="pm-attach-tray" hidden></div>
      <button type="button" class="pm-command-chip" id="pm-chat-command-chip" hidden aria-label="Clear slash command">
        <span class="pm-command-chip-token"></span>
        <span class="pm-command-chip-clear" aria-hidden="true">&times;</span>
      </button>
      <div class="pm-composer-row">
        <button type="button" class="pm-icon-btn" id="pm-attach-btn" aria-label="Attach files">${ICONS.paperclip}</button>
        <textarea class="pm-composer-input" id="pm-composer-input" rows="1" placeholder="Type a message…" aria-label="Message" autocomplete="off" autocapitalize="sentences" enterkeyhint="send"></textarea>
        <button type="button" class="pm-icon-btn" id="pm-chat-mic-btn" aria-label="Voice input">${ICONS.micSmall}</button>
        <button type="submit" class="pm-send" id="pm-send-btn" aria-label="Send">${ICONS.send}</button>
      </div>
      <div class="pm-chat-voice-shell" id="pm-chat-voice-shell" hidden>
        <button type="button" class="pm-chat-voice-camera" id="pm-chat-voice-camera" aria-label="Send camera snapshot">${ICONS.image}</button>
        <button type="button" class="pm-chat-voice-close" id="pm-chat-voice-close" aria-label="Exit voice mode">&times;</button>
        <div class="pm-chat-voice-inline" id="pm-chat-voice-inline" hidden></div>
      </div>
    </form>
    <div class="pm-attach-sheet" id="pm-attach-sheet" hidden>
      <div class="pm-attach-sheet-scrim" id="pm-attach-sheet-scrim"></div>
      <section class="pm-attach-sheet-panel" aria-label="Attach">
        <button type="button" class="pm-attach-sheet-action" data-pm-attach-action="camera">
          <span>${ICONS.image}</span>
          <strong>Camera</strong>
        </button>
        <button type="button" class="pm-attach-sheet-action" data-pm-attach-action="files">
          <span>${ICONS.paperclip}</span>
          <strong>Files</strong>
        </button>
      </section>
    </div>
    <div class="pm-camera-capture" id="pm-camera-capture" hidden>
      <video class="pm-camera-video" id="pm-camera-video" autoplay muted playsinline></video>
      <div class="pm-camera-status" id="pm-camera-status">Opening camera...</div>
      <div class="pm-camera-record-timer" id="pm-camera-record-timer" hidden>0.0s</div>
      <div class="pm-camera-topbar">
        <button type="button" class="pm-camera-icon" id="pm-camera-close" aria-label="Close camera">&times;</button>
        <button type="button" class="pm-camera-icon" id="pm-camera-flip" aria-label="Flip camera">${ICONS.refresh}</button>
      </div>
      <div class="pm-camera-controls">
        <button type="button" class="pm-camera-shutter" id="pm-camera-shutter" aria-label="Capture image"></button>
      </div>
    </div>
    <div class="pm-mobile-side-sheet" id="pm-mobile-side-sheet" role="dialog" aria-modal="true" aria-label="Side chat">
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
          <div class="pm-composer-row">
            <button type="button" class="pm-icon-btn" id="pm-mobile-side-attach" aria-label="Attach files">${ICONS.paperclip}</button>
            <textarea class="pm-composer-input" id="pm-mobile-side-input" rows="1" placeholder="Follow up" aria-label="Side chat message" autocomplete="off" autocapitalize="sentences" enterkeyhint="send"></textarea>
            <button type="button" class="pm-icon-btn" id="pm-mobile-side-mic" aria-label="Voice input">${ICONS.micSmall}</button>
            <button type="submit" class="pm-send" id="pm-mobile-side-send" aria-label="Send side chat">${ICONS.send}</button>
          </div>
        </form>
      </section>
    </div>
  `;
  wireHeaderActions(page, {
    onNewChat: () => _startMobileNewChat(navigate),
  });

  const body     = page.querySelector('#pm-chat-body');
  const threadEl = page.querySelector('#pm-chat-thread');
  const form     = page.querySelector('#pm-composer');
  const input    = page.querySelector('#pm-composer-input');
  const sendBtn  = page.querySelector('#pm-send-btn');
  const attachBtn = page.querySelector('#pm-attach-btn');
  const micBtn = page.querySelector('#pm-chat-mic-btn');
  const chatVoiceShell = page.querySelector('#pm-chat-voice-shell');
  const chatVoiceClose = page.querySelector('#pm-chat-voice-close');
  const chatVoiceCamera = page.querySelector('#pm-chat-voice-camera');
  const chatVoiceHost = page.querySelector('#pm-chat-voice-inline');
  const fileInput = page.querySelector('#pm-file-input');
  const attachTray = page.querySelector('#pm-attach-tray');
  const attachSheet = page.querySelector('#pm-attach-sheet');
  const attachSheetScrim = page.querySelector('#pm-attach-sheet-scrim');
  const cameraCapture = page.querySelector('#pm-camera-capture');
  const cameraVideo = page.querySelector('#pm-camera-video');
  const cameraStatus = page.querySelector('#pm-camera-status');
  const cameraRecordTimer = page.querySelector('#pm-camera-record-timer');
  const cameraClose = page.querySelector('#pm-camera-close');
  const cameraFlip = page.querySelector('#pm-camera-flip');
  const cameraShutter = page.querySelector('#pm-camera-shutter');
  const commandChip = page.querySelector('#pm-chat-command-chip');
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
    busy: false,
    abort: null,
  };

  _pmRefreshSlashChrome(page, input);
  _installMobileTimestampReveal(threadEl);

  const resizeComposerInput = () => {
    if (!input) return;
    const maxHeight = Number(input.dataset.maxHeight || 148);
    input.style.height = 'auto';
    const nextHeight = Math.min(input.scrollHeight || 0, maxHeight);
    input.style.height = `${Math.max(0, nextHeight)}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };
  const resetComposerInput = () => {
    if (!input) return;
    input.value = '';
    input.style.height = '';
    input.style.overflowY = 'hidden';
    _pmHideSkillTriggerPill(page);
    requestAnimationFrame(resizeComposerInput);
  };
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

  function openAttachSheet() {
    if (!attachSheet) {
      fileInput?.click();
      return;
    }
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
  const CAMERA_RECORD_HOLD_MS = 420;
  const CAMERA_RECORD_MAX_MS = 12000;

  function setCameraStatus(text = '') {
    if (cameraStatus) cameraStatus.textContent = text;
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
      stopCameraCapture();
      await onVideoCapture({ file, blob, mimeType: type, ...sampled });
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
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
      cameraStream = null;
    }
    if (cameraVideo) cameraVideo.srcObject = null;
    if (cameraCapture) {
      cameraCapture.classList.remove('open');
      setTimeout(() => {
        if (!cameraCapture.classList.contains('open')) cameraCapture.hidden = true;
      }, 180);
    }
    cameraOpening = false;
    cameraCaptureOptions = { target: 'chat', onCapture: null, onVideoCapture: null };
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
    cameraCapture.hidden = false;
    setCameraStatus('Opening camera...');
    requestAnimationFrame(() => cameraCapture.classList.add('open'));
    try {
      const constraints = {
        video: {
          facingMode: { ideal: cameraFacingMode },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraStream = stream;
      cameraVideo.srcObject = stream;
      cameraVideo.muted = true;
      cameraVideo.setAttribute('playsinline', '');
      await cameraVideo.play();
      setCameraStatus('');
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

  function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not capture camera frame.'));
      }, type, quality);
    });
  }

  async function captureCameraFrame() {
    if (!cameraVideo || !cameraStream) return;
    const width = Number(cameraVideo.videoWidth || 0);
    const height = Number(cameraVideo.videoHeight || 0);
    if (!width || !height) {
      pmToast('Camera is still warming up.', 'info');
      return;
    }
    try {
      setCameraStatus('Capturing...');
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not prepare camera capture.');
      ctx.drawImage(cameraVideo, 0, 0, width, height);
      const blob = await canvasToBlob(canvas);
      const file = new File([blob], `prometheus-camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const normalized = await _normalizeMobileFile(file);
      const target = String(cameraCaptureOptions?.target || 'chat');
      if (target === 'voice' && typeof cameraCaptureOptions?.onCapture === 'function') {
        const onCapture = cameraCaptureOptions.onCapture;
        stopCameraCapture();
        await onCapture(normalized, { file, dataUrl: normalized.dataUrl, blob });
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
    const sid = String(requestedSession || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim();
    const remembered = _readMobileActiveRun(sid);
    const busy = !!(__pmChat.activeRuns?.[sid]?.busy || __pmChat.drawerRunSessionIds?.has?.(sid));
    if (!force && !remembered && !busy) return;
    if (__pmChat.recoverTimer) clearTimeout(__pmChat.recoverTimer);
    __pmChat.recoverTimer = setTimeout(() => refreshMobileRunRecovery({ silent: true, force, fullRefresh }), Math.max(250, Number(delay) || 2500));
  }

  function updateOnlineStatus() {
    const pill = page.querySelector('.pm-online');
    if (!pill) return;
    const wasOffline = pill.classList.contains('offline') || pill.textContent === 'Offline';
    loadGatewayStatus()
      .then(() => {
        pill.textContent = 'Online';
        pill.classList.remove('offline');
        if (wasOffline) scheduleMobileRunRecovery(250, { force: true, fullRefresh: true });
      })
      .catch(() => {
        pill.textContent = 'Offline';
        pill.classList.add('offline');
      });
  }
  if (__pmChat.statusTimer) clearInterval(__pmChat.statusTimer);
  updateOnlineStatus();
  __pmChat.statusTimer = setInterval(updateOnlineStatus, 7000);

  if (!__pmChat.threads[requestedSession]?.length && requestedSession !== MOBILE_CHAT_SESSION_ID) {
    threadEl.innerHTML = '<div class="pm-chat-loading">Loading chat...</div>';
    loadMobileChatSession(requestedSession)
      .then((session) => {
        if (__pmChat.activeSessionId !== requestedSession) return;
        const history = Array.isArray(session?.history) ? session.history : [];
        const localThread = __pmChat.threads[requestedSession] || [];
        __pmChat.threads[requestedSession] = _mergeMobileThreadLocalArtifacts(
          _mapServerHistoryToMobile(history),
          localThread,
        );
        _activeMobileThread();
        _renderThread(threadEl);
        _scrollChat(body);
        refreshMobileRunRecovery({ silent: true, force: true, fullRefresh: true });
      })
      .catch((err) => {
        if (__pmChat.activeSessionId !== requestedSession) return;
        threadEl.innerHTML = `<div class="pm-chat-loading error">Could not load chat: ${escapeHtml(err.message || 'Unknown error')}</div>`;
      });
  }

  async function refreshMobileRunRecovery({ silent = false, force = false, fullRefresh = false } = {}) {
    const remembered = _readMobileActiveRun(requestedSession);
    try {
      const status = await loadMobileChatRunStatus(requestedSession);
      if (!force && !remembered && !status?.active) return;
      // Draft new-chat session has no server-side history — skip even when force=true
      if (requestedSession === MOBILE_CHAT_SESSION_ID && !remembered && !status?.active) return;
      if (__pmChat.activeSessionId !== requestedSession) return;

      if (fullRefresh || force) {
        const session = await loadMobileChatSession(requestedSession).catch(() => null);
        const history = Array.isArray(session?.history) ? session.history : [];
        const localThread = __pmChat.threads[requestedSession] || [];
        if (history.length) {
          __pmChat.threads[requestedSession] = _mergeMobileThreadLocalArtifacts(
            _mapServerHistoryToMobile(history),
            localThread,
          );
          _activeMobileThread();
        }
        const pendingApprovals = await loadMobileApprovals('pending').catch(() => []);
        (Array.isArray(pendingApprovals) ? pendingApprovals : [])
          .filter((approval) => {
            const sid = String(approval?.sessionId || approval?.sourceSessionId || '').trim();
            return !sid || sid === requestedSession;
          })
          .forEach((approval) => _upsertMobilePendingApproval(approval));
      }

      const activeThread = _activeMobileThread();
      let aiTurn = _findLatestAssistantTurn(activeThread);
      if (status?.active) {
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
          };
          activeThread.push(aiTurn);
          hasLocalLiveHistory = false;
        }
        aiTurn.streaming = true;
        const rememberedLastSeq = Math.max(
          Number(__pmChat.activeRuns?.[requestedSession]?.lastSeq || 0) || 0,
          Number(remembered?.lastSeq || 0) || 0,
        );
        const lastSeq = (fullRefresh || force) && !hasLocalLiveHistory ? 0 : rememberedLastSeq;
        if ((fullRefresh || force) && !hasLocalLiveHistory && __pmChat.activeRuns?.[requestedSession]) {
          __pmChat.activeRuns[requestedSession] = { ...__pmChat.activeRuns[requestedSession], lastSeq: 0, streamId: '' };
        }
        const replay = await loadMobileChatStreamReplay(requestedSession, lastSeq).catch(() => null);
        const events = Array.isArray(replay?.events) ? replay.events : [];
        let terminal = '';
        for (const frame of events) {
          const applied = applyMobileChatStreamEvent(aiTurn, replayFrameToEvent(frame));
          if (applied === 'done' || applied === 'error') {
            terminal = applied;
            break;
          }
        }
        if (terminal) {
          finalizeMobileLiveAiTurn(aiTurn);
          return;
        }
        if (!events.length && !String(aiTurn.body?.text || '').trim() && !(Array.isArray(aiTurn.processEntries) && aiTurn.processEntries.length)) {
          _appendMobileProcess(aiTurn, 'info', 'Live run is connected. Waiting for the next update.');
        }
        _rememberMobileActiveRun(requestedSession, {
          startedAt: status.run?.startedAt || remembered?.startedAt,
          disconnected: true,
          streamId: replay?.stream?.streamId || remembered?.streamId || '',
          lastSeq: replay?.stream?.lastSeq || remembered?.lastSeq || 0,
        });
        renderThreadNow();
        setBusy(true);
        return;
      }

      const session = await loadMobileChatSession(requestedSession).catch(() => null);
      const history = Array.isArray(session?.history) ? session.history : [];
      if (history.length) {
        const localThread = __pmChat.threads[requestedSession] || [];
        __pmChat.threads[requestedSession] = _mergeMobileThreadLocalArtifacts(
          _mapServerHistoryToMobile(history),
          localThread,
        );
        _activeMobileThread();
        _renderThread(threadEl);
        _scrollChat(body);
        if (!silent) pmToast('Recovered latest mobile chat result.', 'success');
      }
      _clearMobileActiveRun(requestedSession);
      _markMobileSessionRunning(requestedSession, false);
      setBusy(false);
      const queue = _getMobileQueuedPrompts(requestedSession);
      if (queue.length) {
        const next = queue.shift();
        _renderMobileQueuedPromptsPanel(requestedSession);
        setTimeout(() => sendMessage(next.message, { fromQueue: true, attachments: Array.isArray(next.files) ? next.files : [] }), 0);
      }
    } catch (err) {
      if (_readMobileActiveRun(requestedSession)?.disconnected) scheduleMobileRunRecovery(2500, { fullRefresh });
      if (!silent) pmToast(`Recovery check failed: ${err.message || err}`, 'warn');
    }
  }

  refreshMobileRunRecovery({ silent: true, force: true, fullRefresh: true });
  if (requestedSession && requestedSession !== MOBILE_CHAT_SESSION_ID) {
    markMobileChatSessionRead(requestedSession, Date.now()).catch(() => {});
  }

  function _composerHasOutboundContent() {
    const text = _pmGetComposerValue(input);
    return !!(text.trim() || getPendingAttachments().length);
  }

  function updateComposerSubmitState(sessionForBusy = requestedSession) {
    const sid = String(sessionForBusy || requestedSession || MOBILE_CHAT_SESSION_ID);
    const activeSid = String(__pmChat.activeSessionId || requestedSession || MOBILE_CHAT_SESSION_ID);
    const sessionBusy = !!(__pmChat.activeRuns?.[activeSid]?.busy || __pmChat.activeRuns?.[sid]?.busy);
    const shouldAbort = sessionBusy && !_composerHasOutboundContent();
    const shouldVoice = !sessionBusy && !_composerHasOutboundContent();
    sendBtn.disabled = false;
    sendBtn.classList.toggle('is-abort', shouldAbort);
    sendBtn.classList.toggle('is-voice', shouldVoice);
    sendBtn.title = shouldAbort ? 'Stop Prometheus' : shouldVoice ? 'Start voice mode' : sessionBusy ? 'Queue message' : 'Send';
    sendBtn.innerHTML = shouldAbort
      ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>`
      : shouldVoice
        ? `<img class="pm-send-voice-icon" src="${PM_CHAT_VOICE_ICON_SRC}" alt="" aria-hidden="true" />`
      : ICONS.send;
    sendBtn.setAttribute('aria-label', shouldAbort ? 'Stop' : shouldVoice ? 'Start voice mode' : sessionBusy ? 'Queue message' : 'Send');
  }

  function setBusy(busy, sessionForBusy = requestedSession) {
    const sid = String(sessionForBusy || requestedSession || MOBILE_CHAT_SESSION_ID);
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

  function renderThreadSoon() {
    _scheduleThreadRender(threadEl, body, requestedSession);
  }

  function _currentChatVoiceSessionLabel() {
    const sid = String(requestedSession || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim();
    if (sid === MOBILE_CHAT_SESSION_ID) return 'Mobile - New Chat';
    const firstText = String((__pmChat.threads?.[sid] || []).find((turn) => turn?.role === 'user')?.body?.text || '').trim();
    return firstText ? `Mobile - ${firstText.slice(0, 42)}` : 'Mobile - Chat';
  }

  function _setChatVoiceTarget() {
    const sid = String(requestedSession || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
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
    form?.classList.toggle('is-voice-active', !!active);
    body?.classList.toggle('pm-chat-voice-occluded', !!active);
    if (chatVoiceShell) chatVoiceShell.hidden = !active;
    if (chatVoiceHost) chatVoiceHost.hidden = !active;
    updateChatComposerSpace();
  }

  function updateChatComposerSpace() {
    requestAnimationFrame(() => {
      if (!body || !form) return;
      const scrollSnapshot = _mobileChatScrollSnapshot(body);
      const height = Math.ceil(form.getBoundingClientRect?.().height || 0);
      const space = Math.max(170, height + 28);
      body.style.setProperty('--pm-chat-composer-space', `${space}px`);
      if (form.classList.contains('is-voice-active') && chatVoiceShell && !chatVoiceShell.hidden) {
        const bodyRect = body.getBoundingClientRect?.();
        const shellRect = chatVoiceShell.getBoundingClientRect?.();
        const occlusionTop = Math.max(0, Math.floor((shellRect?.top || 0) - (bodyRect?.top || 0)));
        body.style.setProperty('--pm-chat-voice-occlusion-top', `${occlusionTop}px`);
      } else {
        body.style.removeProperty('--pm-chat-voice-occlusion-top');
      }
      _restoreMobileChatScroll(body, scrollSnapshot);
    });
  }

  function resizeSideInput() {
    if (!sideInput) return;
    const maxHeight = Number(sideInput.dataset.maxHeight || 148);
    sideInput.style.height = 'auto';
    const nextHeight = Math.min(sideInput.scrollHeight || 0, maxHeight);
    sideInput.style.height = `${Math.max(0, nextHeight)}px`;
    sideInput.style.overflowY = sideInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  function renderMobileSideSheet() {
    if (!sideThreadEl) return;
    const visible = (Array.isArray(sideState.thread) ? sideState.thread : [])
      .filter((msg, index) => msg && msg.sideChatBoundary !== true && !_isMobileHiddenVoiceDraftMessage(msg, index));
    sideThreadEl.innerHTML = visible.length
      ? visible.map((msg, index) => _renderChatMessageHtml(msg, index)).join('')
      : '<div class="pm-mobile-side-empty">Start the side chat from /side.</div>';
    _wireMobileProcessRunActions(sideThreadEl);
    _wireMobileMediaCards(sideThreadEl);
    _wireMobileFileChangeRows(sideThreadEl);
    requestAnimationFrame(() => {
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
    }, 90);
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
    const currentThread = Array.isArray(__pmChat.threads[requestedSession]) ? __pmChat.threads[requestedSession] : [];
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
    sideState.link = result.link;
    sideState.thread = Array.isArray(result.thread) ? result.thread : [];
    setMobileSideBusy(false);
    if (sideTitleEl) sideTitleEl.textContent = result.link?.title || 'Side Chat';
    if (sideSubtitleEl) sideSubtitleEl.textContent = `Prometheus · ${String(parentSessionId).startsWith('mobile_') ? 'Mobile' : 'Chat'}`;
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
    sideSheet?.classList.remove('open');
  }

  function applyMobileSideStreamEvent(aiTurn, evt) {
    if (!aiTurn || !evt?.type) return '';
    switch (String(evt.type || '')) {
      case 'token':
        if (evt.text) {
          const chunk = String(evt.text);
          if (aiTurn.agentExecutionMode === 'execute' && !aiTurn.finalResponseStarted) {
            _appendMobileLiveTrace(aiTurn, aiTurn.toolActivityStarted ? 'think' : 'preamble', chunk, { append: true });
          } else {
            aiTurn.finalResponseStarted = true;
            aiTurn.body.text += chunk;
            aiTurn.content = String(aiTurn.body.text || '');
          }
        }
        scheduleSideRenderSoon();
        return 'streaming';
      case 'agent_mode':
        aiTurn.agentExecutionMode = String(evt.mode || aiTurn.agentExecutionMode || '').trim();
        if (aiTurn.agentExecutionMode === 'execute') _moveMobilePreToolAnswerIntoPreamble(aiTurn);
        if (evt.mode) _appendMobileProcess(aiTurn, 'info', `Agent mode: ${evt.mode}${evt.turnKind ? ` (${evt.turnKind})` : ''}`, evt);
        scheduleSideRenderSoon();
        return 'streaming';
      case 'thinking_delta': {
        const text = String(evt.thinking || evt.text || '');
        if (text) {
          _appendMobileProcess(aiTurn, 'think', text.trim().slice(0, 220));
          _appendMobileLiveTrace(aiTurn, 'think', text, { append: true });
        }
        scheduleSideRenderSoon();
        return 'streaming';
      }
      case 'info':
      case 'ui_preflight':
      case 'heartbeat':
      case 'tool_progress':
        if (evt.message) {
          if (String(evt.type || '') === 'tool_progress') _moveMobilePreToolAnswerIntoPreamble(aiTurn);
          if (String(evt.type || '') === 'tool_progress') aiTurn.toolActivityStarted = true;
          _appendMobileProcess(aiTurn, 'info', String(evt.message), evt);
          _appendMobileLiveTrace(aiTurn, String(evt.type || '') === 'tool_progress' ? 'tool' : 'info', String(evt.message));
        }
        renderMobileSideSheet();
        return 'streaming';
      case 'tool_call':
        _moveMobilePreToolAnswerIntoPreamble(aiTurn);
        aiTurn.toolActivityStarted = true;
        _appendMobileProcess(aiTurn, 'tool', _mobileToolLabel(evt), evt);
        _appendMobileLiveTrace(aiTurn, 'tool', _mobileToolLabel(evt));
        renderMobileSideSheet();
        return 'streaming';
      case 'tool_result':
        _moveMobilePreToolAnswerIntoPreamble(aiTurn);
        aiTurn.toolActivityStarted = true;
        _collectMediaFromToolEvent(aiTurn, evt);
        _appendMobileProcess(aiTurn, evt.error ? 'error' : 'result', `${_mobileToolLabel(evt)}${evt.error ? ' failed' : ' complete'}`, evt);
        _appendMobileLiveTrace(aiTurn, evt.error ? 'error' : 'result', `${_mobileToolLabel(evt)}${evt.error ? ' failed' : ' complete'}`);
        renderMobileSideSheet();
        return 'streaming';
      case 'final':
        _collectMediaFromToolEvent(aiTurn, evt);
        if (evt.fileChanges) aiTurn.fileChanges = evt.fileChanges;
        if (evt.productCarousel) _mergeMobileProductCarouselIntoMessage(aiTurn, evt.productCarousel);
        if (Array.isArray(evt.richArtifacts) && evt.richArtifacts.length) aiTurn.richArtifacts = evt.richArtifacts;
        if (evt.text) {
          aiTurn.finalResponseStarted = true;
          aiTurn.body.text = String(evt.text);
        }
        aiTurn.content = String(aiTurn.body.text || '');
        flushSideRender();
        return 'final';
      case 'done':
        _collectMediaFromToolEvent(aiTurn, evt);
        if (evt.fileChanges) aiTurn.fileChanges = evt.fileChanges;
        if (evt.productCarousel) _mergeMobileProductCarouselIntoMessage(aiTurn, evt.productCarousel);
        if (Array.isArray(evt.richArtifacts) && evt.richArtifacts.length) aiTurn.richArtifacts = evt.richArtifacts;
        if (evt.reply && !String(aiTurn.body.text || '').trim()) {
          aiTurn.finalResponseStarted = true;
          aiTurn.body.text = String(evt.reply);
        }
        aiTurn.content = String(aiTurn.body.text || '');
        flushSideRender();
        return 'done';
      case 'error':
        _appendMobileProcess(aiTurn, 'error', String(evt.message || 'Chat error'), evt);
        aiTurn.body.text = (aiTurn.body.text ? `${aiTurn.body.text}\n\n` : '') + `Warning: ${String(evt.message || 'Chat error')}`;
        aiTurn.content = aiTurn.body.text;
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
    if (!sideId) return;
    if (sideState.busy && !msg) {
      try { sideState.abort?.abort?.(); } catch {}
      return;
    }
    if (!msg || sideState.busy) return;
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
        aiTurn.body.text = (aiTurn.body.text ? `${aiTurn.body.text}\n\n` : '') + `Warning: ${err?.message || 'Chat error'}`;
        aiTurn.content = aiTurn.body.text;
        finishMobileSideTurn();
        pmToast(err?.message || 'Side chat failed', 'error');
      },
      onDone: () => finishMobileSideTurn(),
    });
    sideState.abort = { abort: () => {
      try { stream.abort(); } catch {}
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
  let _pmKbRaf = 0;
  let _pmKbWasOpen = false;
  let _pmKbPinRaf = 0;
  let _pmKbPinUntil = 0;
  function _pmKbPinScroll() {
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
    if (!vv || !_pmKbApp) return;
    // Keyboard height = layout viewport height minus the visible (visual)
    // viewport height. The shell stays anchored to the layout viewport, so the
    // composer only needs to float up by this amount.
    const offset = Math.max(0, Math.round(window.innerHeight - vv.height));
    // Ignore small deltas from Safari's collapsing URL bar; only treat a
    // sizeable gap as a real keyboard.
    const open = offset > 90;
    _pmKbApp.style.setProperty('--pm-keyboard-offset', `${open ? offset : 0}px`);
    _pmKbApp.classList.toggle('pm-keyboard-open', open);
    // While the keyboard is open, keep the document pinned to the top so iOS
    // can't leave the fixed shell lifted above the keyboard.
    if (open) _pmKbPinScroll();
    // When the keyboard first opens, keep the newest message visible above the
    // composer if the user was already pinned near the bottom.
    if (open && !_pmKbWasOpen) {
      const snap = _mobileChatScrollSnapshot(body);
      if (snap.nearBottom) requestAnimationFrame(() => _scrollChat(body));
    }
    _pmKbWasOpen = open;
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
    _pmKbPinUntil = Math.max(_pmKbPinUntil, performance.now() + ms);
    if (!_pmKbPinRaf) _pmKbPinRaf = requestAnimationFrame(_pmKbPinLoop);
  }
  const _onVvResize = () => { _scheduleKeyboardOffset(); _startKbPinLoop(400); };
  const _onVvScroll = () => { _scheduleKeyboardOffset(); };
  const _pmVisualViewport = window.visualViewport || null;
  if (_pmVisualViewport) {
    _pmVisualViewport.addEventListener('resize', _onVvResize);
    _pmVisualViewport.addEventListener('scroll', _onVvScroll);
  }
  const _onComposerFocusKb = () => {
    // Pin aggressively through the keyboard's open animation so the shell never
    // ends up stuck above the keyboard waiting for a manual scroll.
    _startKbPinLoop(800);
  };
  const _onComposerBlurKb = () => {
    _pmKbPinUntil = 0;
    setTimeout(_scheduleKeyboardOffset, 60);
  };
  input?.addEventListener('focus', _onComposerFocusKb);
  input?.addEventListener('blur', _onComposerBlurKb);
  function _teardownKeyboardController() {
    if (_pmKbRaf) { cancelAnimationFrame(_pmKbRaf); _pmKbRaf = 0; }
    if (_pmKbPinRaf) { cancelAnimationFrame(_pmKbPinRaf); _pmKbPinRaf = 0; }
    _pmKbPinUntil = 0;
    if (_pmVisualViewport) {
      _pmVisualViewport.removeEventListener('resize', _onVvResize);
      _pmVisualViewport.removeEventListener('scroll', _onVvScroll);
    }
    input?.removeEventListener('focus', _onComposerFocusKb);
    input?.removeEventListener('blur', _onComposerBlurKb);
    if (_pmKbApp) {
      _pmKbApp.classList.remove('pm-keyboard-open');
      _pmKbApp.style.removeProperty('--pm-keyboard-offset');
    }
  }

  function _closeChatVoiceMode() {
    chatVoiceHost?._pmCleanup?.();
    if (chatVoiceHost) {
      chatVoiceHost.innerHTML = '';
      chatVoiceHost.hidden = true;
      delete chatVoiceHost.dataset.pmVoiceMounted;
    }
    if (chatVoiceShell) chatVoiceShell.hidden = true;
    form?.classList.remove('is-voice-active');
    body?.classList.remove('pm-chat-voice-occluded');
    updateChatComposerSpace();
    updateComposerSubmitState();
  }

  function _onChatVoiceUpdate(sessionId, detail = {}) {
    const sid = String(sessionId || __pmChat.activeSessionId || requestedSession || MOBILE_CHAT_SESSION_ID).trim();
    if (sid && requestedSession === MOBILE_CHAT_SESSION_ID && sid !== MOBILE_CHAT_SESSION_ID) {
      requestedSession = sid;
      _rememberMobileLastChatSession(sid);
      try { window.history.replaceState(null, '', `${window.location.pathname || '/'}${window.location.search || ''}#mobile/chat/${encodeURIComponent(sid)}`); } catch {}
      invalidateMobileDrawerSessions('mobile');
    }
    if (!sid || sid === requestedSession || sid === __pmChat.activeSessionId) {
      if (sid && __pmChat.threads?.[sid]) {
        __pmChat.activeSessionId = sid;
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
    if (detail?.force === true) {
      if (__pmChat.threads?.[sid]) {
        __pmChat.activeSessionId = sid;
        __pmChat.thread = __pmChat.threads[sid];
      }
      _flushThreadRender(threadEl, body, sid);
      updateComposerSubmitState(sid);
    }
  }

  const previousVoiceUpdateBridge = window.__pmMobileChatVoiceUpdate;
  window.__pmMobileChatVoiceUpdate = _onChatVoiceUpdate;
  const _chatVoiceUpdateEventHandler = (event) => {
    const update = event?.detail || {};
    _onChatVoiceUpdate(update.sessionId, update);
  };
  window.addEventListener('pm-mobile-chat-voice-update', _chatVoiceUpdateEventHandler);
  chatVoiceClose?.addEventListener('click', _closeChatVoiceMode);

  async function _toggleChatVoiceMode({ autoStart = false } = {}) {
    if (!chatVoiceHost) return;
    _setChatVoiceTarget();
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
        cameraButton: chatVoiceCamera,
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

  async function forkMobileConversationFromMessage(index) {
    const thread = _activeMobileThread();
    const msg = thread[index];
    if (!_isMobileAssistantMessage(msg)) return;
    const forkedThread = thread.slice(0, index + 1).map(_cloneMobileMessageForBranch).filter(Boolean);
    const sid = createMobileChatSessionId();
    const titleSeed = forkedThread.find((item) => item.role === 'user')?.body?.text || 'Forked chat';
    const title = String(titleSeed || 'Forked chat').replace(/\s+/g, ' ').trim().slice(0, 72) || 'Forked chat';
    try {
      await createMobileChatSession(sid, { title });
      await updateMobileChatSessionHistory(sid, _mobileHistoryForServer(forkedThread));
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
    if (action === 'copy') return copyMobileChatMessage(index);
    if (action === 'fork') return forkMobileConversationFromMessage(index);
    if (action === 'edit') return startMobileEditUserMessage(index);
    if (action === 'cancel-edit') return cancelMobileEditUserMessage(index);
    if (action === 'submit-edit') return submitMobileEditedUserMessage(index);
    if (action === 'variant-prev') return switchMobilePromptVariant(index, _getMobilePromptVariantActiveIndex(index) - 1);
    if (action === 'variant-next') return switchMobilePromptVariant(index, _getMobilePromptVariantActiveIndex(index) + 1);
  }

  function noteChatStreamSeq(evt) {
    if (!evt) return true;
    const cid = typeof evt.clientRequestId === 'string' ? evt.clientRequestId.trim() : '';
    if (cid) {
      if (!__pmChat.sentClientRequestIds || typeof __pmChat.sentClientRequestIds !== 'object') __pmChat.sentClientRequestIds = {};
      const previous = __pmChat.sentClientRequestIds[requestedSession];
      if (previous && previous !== cid) return false;
      __pmChat.sentClientRequestIds[requestedSession] = cid;
    }
    const seq = Math.max(0, Math.floor(Number(evt?.seq || 0)) || 0);
    const streamId = evt?.streamId ? String(evt.streamId) : '';
    if (!seq) return true;
    if (!__pmChat.activeRuns || typeof __pmChat.activeRuns !== 'object') __pmChat.activeRuns = {};
    const run = __pmChat.activeRuns[requestedSession] || {};
    const prevSeq = Math.max(0, Math.floor(Number(run.lastSeq || 0)) || 0);
    if (seq <= prevSeq) return false;
    __pmChat.activeRuns[requestedSession] = { ...run, busy: true, lastSeq: seq, streamId: streamId || run.streamId || '' };
    _rememberMobileActiveRun(requestedSession, { lastSeq: seq, streamId: streamId || run.streamId || '' });
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

  function applyMobileChatStreamEvent(aiTurn, evt) {
    aiTurn = _mobileStreamTargetTurn(aiTurn);
    if (!aiTurn || !evt?.type) return '';
    if (!noteChatStreamSeq(evt)) return 'duplicate';
    switch (evt.type) {
      case 'token':
        if (evt.text) {
          const chunk = String(evt.text);
          if (aiTurn.agentExecutionMode === 'execute' && !aiTurn.finalResponseStarted) {
            _appendMobileLiveTrace(aiTurn, aiTurn.toolActivityStarted ? 'think' : 'preamble', chunk, { append: true });
          } else {
            aiTurn.finalResponseStarted = true;
            aiTurn.body.text += chunk;
            aiTurn.content = String(aiTurn.body.text || '');
          }
        }
        renderThreadSoon();
        return 'streaming';
      case 'agent_mode':
        aiTurn.agentExecutionMode = String(evt.mode || aiTurn.agentExecutionMode || '').trim();
        if (aiTurn.agentExecutionMode === 'execute') _moveMobilePreToolAnswerIntoPreamble(aiTurn);
        if (evt.mode) _appendMobileProcess(aiTurn, 'info', `Agent mode: ${evt.mode}${evt.turnKind ? ` (${evt.turnKind})` : ''}`, evt);
        renderThreadSoon();
        return 'streaming';
      case 'thinking_delta': {
        const text = String(evt.thinking || evt.text || '');
        if (text) {
          _appendMobileProcess(aiTurn, 'think', text.slice(0, 220));
          _appendMobileLiveTrace(aiTurn, 'think', text, { append: true });
          renderThreadSoon();
        }
        return 'streaming';
      }
      case 'info':
      case 'ui_preflight':
      case 'heartbeat':
        if (evt.message) {
          _appendMobileProcess(aiTurn, 'info', String(evt.message));
          _appendMobileLiveTrace(aiTurn, 'info', String(evt.message));
          renderThreadSoon();
        }
        return 'streaming';
      case 'tool_call': {
        _moveMobilePreToolAnswerIntoPreamble(aiTurn);
        aiTurn.toolActivityStarted = true;
        const label = _mobileToolLabel(evt);
        const args = _safeJsonPreview(evt.args || evt.params || evt.input);
        _appendMobileProcess(aiTurn, 'tool', `${label}${args ? `: ${args}` : ''}`, evt);
        _appendMobileLiveTrace(aiTurn, 'tool', `${label}${args ? `: ${args}` : ''}`);
        renderThreadSoon();
        return 'streaming';
      }
      case 'tool_result': {
        _moveMobilePreToolAnswerIntoPreamble(aiTurn);
        aiTurn.toolActivityStarted = true;
        const label = _mobileToolLabel(evt);
        const result = _safeJsonPreview(evt.result || evt.output || evt.error || '', 180);
        _collectMediaFromToolEvent(aiTurn, evt);
        _appendMobileProcess(aiTurn, evt.error ? 'error' : 'result', `${label}${result ? ` -> ${result}` : ' complete'}`, evt);
        _appendMobileLiveTrace(aiTurn, evt.error ? 'error' : 'result', `${label}${evt.error ? ' failed' : ' complete'}`);
        renderThreadSoon();
        return 'streaming';
      }
      case 'tool_progress': {
        _moveMobilePreToolAnswerIntoPreamble(aiTurn);
        aiTurn.toolActivityStarted = true;
        const progressText = `${_mobileToolLabel(evt)}: ${String(evt.message || '').trim()}`;
        _appendMobileProcess(aiTurn, 'info', progressText, evt);
        _appendMobileLiveTrace(aiTurn, 'tool', progressText);
        renderThreadSoon();
        return 'streaming';
      }
      case 'canvas_present': {
        const path = String(evt.path || '').trim();
        if (!path) return 'streaming';
        const name = evt.name || path.split(/[\\/]/).pop();
        const kind = _mobileMediaKind({ path, name });
        _mergeMobileMediaIntoMessage(aiTurn, [{ path, name, kind }]);
        _appendMobileProcess(aiTurn, 'file', `Presented file: ${path}`, evt);
        renderThreadNow();
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
          _moveMobilePreToolAnswerIntoPreamble(aiTurn);
          aiTurn.toolActivityStarted = true;
          const name = String(modelEvent.name || 'tool').replace(/_/g, ' ');
          _appendMobileLiveTrace(aiTurn, 'tool', eventType === 'tool_call_start' ? `Preparing ${name}...` : `Prepared ${name}`);
          renderThreadSoon();
        }
        return 'streaming';
      }
      case 'model_switched':
      case 'main_model_changed': {
        const model = evt.model || evt.modelRef || evt.providerId || 'model';
        _appendMobileProcess(aiTurn, 'info', `Model: ${model}`, evt);
        renderThreadSoon();
        return 'streaming';
      }
      case 'session_title':
        invalidateMobileDrawerSessions('mobile');
        return 'streaming';
      case 'final':
        _collectMediaFromToolEvent(aiTurn, evt);
        if (evt.fileChanges) aiTurn.fileChanges = evt.fileChanges;
        if (evt.productCarousel) _mergeMobileProductCarouselIntoMessage(aiTurn, evt.productCarousel);
        if (Array.isArray(evt.richArtifacts) && evt.richArtifacts.length) aiTurn.richArtifacts = evt.richArtifacts;
        if (evt.text) {
          aiTurn.finalResponseStarted = true;
          aiTurn.body.text = String(evt.text);
        }
        renderThreadSoon();
        return 'final';
      case 'done':
        _collectMediaFromToolEvent(aiTurn, evt);
        if (evt.fileChanges) aiTurn.fileChanges = evt.fileChanges;
        if (evt.productCarousel) _mergeMobileProductCarouselIntoMessage(aiTurn, evt.productCarousel);
        if (Array.isArray(evt.richArtifacts) && evt.richArtifacts.length) aiTurn.richArtifacts = evt.richArtifacts;
        if (evt.reply && !String(aiTurn.body.text || '').trim()) {
          aiTurn.finalResponseStarted = true;
          aiTurn.body.text = String(evt.reply);
        }
        return 'done';
      case 'error':
        _appendMobileProcess(aiTurn, 'error', String(evt.message || 'Chat error'), evt);
        aiTurn.body.text = (aiTurn.body.text ? `${aiTurn.body.text}\n\n` : '') + `Warning: ${String(evt.message || 'Chat error')}`;
        renderThreadNow();
        return 'error';
      default:
        return '';
    }
  }

  function finalizeMobileLiveAiTurn(aiTurn) {
    if (!aiTurn) return;
    aiTurn.streaming = false;
    aiTurn.workEndedAt = Number(aiTurn.workEndedAt || Date.now()) || Date.now();
    aiTurn.workDurationMs = Math.max(0, aiTurn.workEndedAt - _mobileAssistantWorkStartedAt(aiTurn));
    aiTurn.time = _nowTime();
    aiTurn.timestamp = Number(aiTurn.timestamp || Date.now()) || Date.now();
    aiTurn.content = String(aiTurn.body?.text || '');
    _mergeMobileLiveTraceIntoProcess(aiTurn);
    if (__pmChat.activeRuns?.[requestedSession]) __pmChat.activeRuns[requestedSession].abort = null;
    __pmChat.abort = null;
    _clearMobileActiveRun(requestedSession);
    _markMobileSessionRunning(requestedSession, false);
    markMobileChatSessionRead(requestedSession, Date.now()).catch(() => {});
    renderThreadNow();
    updateMobileChatSessionHistory(requestedSession, _mobileHistoryForServer(_activeMobileThread())).catch((err) => {
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
    return ['/models', '/new', '/screenshot', '/restart', '/stop', '/stop_now'].includes(raw) ? raw : '';
  }

  async function requestMobileMainChatAbort(sessionId = requestedSession, { showToast = true } = {}) {
    const sid = String(sessionId || requestedSession || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
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
        _appendMobileProcess(aiTurn, 'warn', 'Stop requested. Asking the gateway to abort the live runtime.');
        const streamed = String(aiTurn.body?.text || aiTurn.content || '').trim();
        aiTurn.body = aiTurn.body || { sender: 'Prometheus', text: '' };
        aiTurn.body.text = streamed
          ? `[Stopped by user]\n\n${streamed}`
          : '[Generation stopped by user. Gateway abort requested and process log preserved.]';
        aiTurn.content = aiTurn.body.text;
        finalizeMobileLiveAiTurn(aiTurn);
      }
      _clearMobileActiveRun(sid);
      _markMobileSessionRunning(sid, false);
      setBusy(false, sid);
    }

    try {
      const direct = await stopMobileMainChat(sid);
      if (direct?.success) {
        if (showToast) pmToast('Stop requested.', 'success');
        return { success: true, message: direct.message || 'Main chat abort requested.', localAbortRequested, result: direct };
      }

      const targetsResult = await loadMobileStopTargets().catch(() => null);
      const targets = Array.isArray(targetsResult?.targets) ? targetsResult.targets : [];
      const match = targets.find((target) =>
        target?.abortable !== false &&
        String(target?.sessionId || '').trim() === sid
      );
      if (match?.id) {
        const fallback = await stopMobileRuntime(match.id);
        if (fallback?.success) {
          if (showToast) pmToast('Stop requested.', 'success');
          return { success: true, message: fallback.message || 'Abort requested.', localAbortRequested, result: fallback };
        }
        return { success: localAbortRequested, message: fallback?.message || fallback?.error || direct?.message || 'Abort request sent.', localAbortRequested, result: fallback };
      }

      return {
        success: localAbortRequested,
        message: localAbortRequested
          ? 'Local stream abort requested.'
          : (direct?.message || 'No active main chat turn found for this session.'),
        localAbortRequested,
        result: direct,
      };
    } catch (err) {
      if (!localAbortRequested) throw err;
      return { success: true, message: 'Local stream abort requested.', localAbortRequested, error: err };
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
      navigate?.('#mobile/settings/models');
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

    if (command === '/screenshot') {
      addCommandTurn(command, {
        text: 'Choose what to capture. Desktop and Browser mirror the Telegram screenshot flow; Clickable UI Map overlays numbered desktop elements for coordinate-free clicking.',
        actions: screenshotRootActions(),
      });
      return true;
    }

    if (command === '/stop_now') {
      const turn = addCommandTurn(command, { text: 'Requesting abort for the active main chat turn...' });
      try {
        const r = await requestMobileMainChatAbort(requestedSession, { showToast: false });
        updateCommandTurn(turn, { text: r?.message || (r?.success ? 'Main chat abort requested.' : 'No active main chat turn found.') });
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

  async function _browseTo(turn, cwdRel) {
    turn.body.browseState = { loading: true, cwd: cwdRel, dirs: [], files: [], error: null };
    turn.body.text = '';
    renderThreadNow();
    try {
      const data = await loadMobileWorkspaceFiles(cwdRel);
      const entries = Array.isArray(data?.files) ? data.files : [];
      turn.body.browseState = {
        loading: false,
        cwd: cwdRel,
        dirs: entries.filter(e => e.type === 'dir').map(e => ({ name: e.name, path: e.path })),
        files: entries.filter(e => e.type === 'file').map(e => ({ name: e.name, path: e.path, kind: _mobileMediaKind({ path: e.path, name: e.name }) })),
        error: null,
      };
    } catch (err) {
      turn.body.browseState = { loading: false, cwd: cwdRel, dirs: [], files: [], error: err.message || String(err) };
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
        navigate?.('#mobile/settings/models');
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
        const restartSessionId = __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID;
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
        const r = await stopMobileRuntime(id);
        updateCommandTurn(turn, { text: r?.message || (r?.success ? 'Abort requested.' : 'Abort failed.'), actions: [] });
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
      && String(__pmRealtimeAgent.conn?.provider || 'openai_realtime') !== 'xai'
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
    const fromQueue = options.fromQueue === true;
    if (!fromQueue && (__pmChat.activeRuns?.[busySessionId]?.busy || __pmChat.activeRuns?.[requestedSession]?.busy)) {
      const queue = _getMobileQueuedPrompts(busySessionId);
      if (queue.length >= PM_MOBILE_MAX_QUEUED_PROMPTS) {
        pmToast(`Queue full (${PM_MOBILE_MAX_QUEUED_PROMPTS}). Wait for Prometheus to finish.`, 'warn');
        return;
      }
      queue.push(_makeMobileQueuedPrompt(msg || 'Attached file(s)', files));
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

    const isUnsavedDraftSession = requestedSession === MOBILE_CHAT_SESSION_ID;
    const actualSessionId = isUnsavedDraftSession ? createMobileChatSessionId() : requestedSession;
    if (isUnsavedDraftSession) {
      __pmChat.threads[actualSessionId] = Array.isArray(__pmChat.threads[requestedSession]) ? __pmChat.threads[requestedSession] : [];
      __pmChat.attachments[actualSessionId] = files.slice();
      __pmChat.activeSessionId = actualSessionId;
      _rememberMobileLastChatSession(actualSessionId);
      __pmChat.threads[requestedSession] = [];
      __pmChat.attachments[requestedSession] = [];
      try { window.history.replaceState(null, '', `${window.location.pathname || '/'}${window.location.search || ''}#mobile/chat/${encodeURIComponent(actualSessionId)}`); } catch {}
      requestedSession = actualSessionId;
      __pmVoice.targetSessionId = actualSessionId;
      __pmVoice.targetSessionLabel = _currentChatVoiceSessionLabel();
      __pmVoice.targetSessionChannel = 'mobile';
      __pmVoice.targetSessionForced = true;
      if (__pmVoice.activeVoiceRuntime) __pmVoice.activeVoiceRuntime.isStreamActive = false;
      __pmVoice.activeVoiceRuntime = null;
      invalidateMobileDrawerSessions('mobile');
    }
    const activeThread = __pmChat.threads[actualSessionId] || (__pmChat.threads[actualSessionId] = []);
    __pmChat.thread = activeThread;
    if (stagedVoiceImages.length) {
      _flushMobileRealtimeAgentPendingImages('typed_chat_send', {
        promptText: msg,
        createResponse: __pmVoice?.settings?.voiceMode === 'openai_realtime',
      }).catch(() => {});
    }

    if (!Array.isArray(options.attachments)) {
      __pmChat.attachments[actualSessionId] = [];
      if (!isUnsavedDraftSession) renderPendingAttachments();
      else attachTray.hidden = true;
    }
    setBusy(true, actualSessionId);
    _markMobileSessionRunning(actualSessionId, true);
    _rememberMobileActiveRun(actualSessionId);

    const uploadResults = files.length ? await _uploadMobileChatAttachments(files) : [];
    const failedUploads = uploadResults.filter((r) => r.error);
    if (failedUploads.length) pmToast(`${failedUploads.length} attachment upload failed`, 'error');
    const visionAttachments = files
      .filter(f => f.kind === 'image' && f.base64 && f.mimeType)
      .map(f => ({ type: 'image', base64: f.base64, mimeType: f.mimeType, name: f.name }));
    const messageForApi = buildMessageWithAttachments(msg, files, uploadResults);
    const clientRequestId = _newMobileClientRequestId(actualSessionId);
    if (!__pmChat.sentClientRequestIds || typeof __pmChat.sentClientRequestIds !== 'object') __pmChat.sentClientRequestIds = {};
    __pmChat.sentClientRequestIds[actualSessionId] = clientRequestId;

    // Push user bubble unless an edit/reprompt already replaced it in-place.
    if (options.skipUserBubble !== true) {
      activeThread.push(_makeMobileUserMessage(msg || 'Attached file(s)', files));
    }
    _reindexMobileThread(activeThread);

    // Push streaming AI placeholder
    const aiTurn = {
      role: 'ai', streaming: true, time: '', timestamp: Date.now(),
      workStartedAt: Date.now(),
      body: { sender: '', text: '' },
      content: '',
      processEntries: [],
      liveTraceEntries: [],
      agentExecutionMode: 'execute',
      _clientRequestId: clientRequestId,
    };
    activeThread.push(aiTurn);
    _appendMobileUserProcess(aiTurn, msg || 'Attached file(s)', {
      stage: 'mobile_chat_user_message',
      sessionId: actualSessionId,
      clientRequestId,
    });
    renderThreadNow();

    let stoppedByUser = false;
    let turnFinished = false;

    const finishAiTurn = () => {
      if (turnFinished) return;
      turnFinished = true;
      const targetAiTurn = _mobileStreamTargetTurn(aiTurn);
      if (stoppedByUser) {
        _appendMobileProcess(targetAiTurn, 'warn', 'Generation stopped by user. Gateway abort requested; process log preserved.');
        const streamed = String(targetAiTurn.body.text || '').trim();
        targetAiTurn.body.text = streamed
          ? `[Stopped by user]\n\n${streamed}`
          : '[Generation stopped by user. Gateway abort requested and process log preserved.]';
      }
      targetAiTurn.streaming = false;
      targetAiTurn.workEndedAt = Number(targetAiTurn.workEndedAt || Date.now()) || Date.now();
      targetAiTurn.workDurationMs = Math.max(0, targetAiTurn.workEndedAt - _mobileAssistantWorkStartedAt(targetAiTurn));
      targetAiTurn.time = _nowTime();
      targetAiTurn.timestamp = Number(targetAiTurn.timestamp || Date.now()) || Date.now();
      targetAiTurn.content = String(targetAiTurn.body?.text || '');
      _mergeMobileLiveTraceIntoProcess(targetAiTurn);
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
      if (!stoppedByUser) markMobileChatSessionRead(actualSessionId, Date.now()).catch(() => {});
      if (__pmChat.sentClientRequestIds?.[actualSessionId] === clientRequestId) delete __pmChat.sentClientRequestIds[actualSessionId];
      renderThreadNow();
      updateMobileChatSessionHistory(actualSessionId, _mobileHistoryForServer(_activeMobileThread())).catch((err) => {
        console.warn('[mobile chat] failed to persist completed turn:', err);
      });
      setBusy(false, actualSessionId);
    };

    const runNextQueuedMobilePrompt = () => {
      const queue = _getMobileQueuedPrompts(actualSessionId);
      if (!queue.length) return;
      const next = queue.shift();
      _renderMobileQueuedPromptsPanel(actualSessionId);
      pmToast(queue.length ? `Running queued prompt (${queue.length} remaining).` : 'Running queued prompt.', 'info');
      setTimeout(() => {
        sendMessage(next.message, { fromQueue: true, attachments: Array.isArray(next.files) ? next.files : [] });
      }, 0);
    };

    const stream = streamChat({
      message: messageForApi,
      sessionId: actualSessionId,
      attachments: visionAttachments,
      attachmentPreviews: files.map(_sanitizeMobileAttachmentPreviewForServer),
      clientRequestId,
    }, {
      onEvent: (evt) => {
        const applied = applyMobileChatStreamEvent(aiTurn, evt);
        if (applied === 'done' || applied === 'error') finishAiTurn();
      },
      onError: (err) => {
        if (stoppedByUser || err?.name === 'AbortError') return;
        const targetAiTurn = _mobileStreamTargetTurn(aiTurn);
        const message = err?.message || 'Chat error';
        if (err?.mobileStreamDisconnected) {
          targetAiTurn.body.text = targetAiTurn.body.text || "Connection dropped, but Prometheus may still be working. I'll keep checking and recover the result here.";
          targetAiTurn.streaming = true;
          _appendMobileProcess(targetAiTurn, 'warn', message);
          _rememberMobileActiveRun(actualSessionId, { disconnected: true });
          pmToast('Connection dropped - recovery mode is on.', 'warn');
          scheduleMobileRunRecovery(2500, { force: true });
        } else {
          targetAiTurn.body.text = (targetAiTurn.body.text ? targetAiTurn.body.text + '\n\n' : '') + `Warning: ${message}`;
          _appendMobileProcess(targetAiTurn, 'error', message);
          _clearMobileActiveRun(actualSessionId);
          pmToast(message, 'error');
          finishAiTurn();
        }
        renderThreadNow();
      },
      onDone: () => {
        if (!stoppedByUser && aiTurn.streaming && _readMobileActiveRun(actualSessionId)?.disconnected) {
          setBusy(true, actualSessionId);
          scheduleMobileRunRecovery(2500, { force: true });
          return;
        }
        finishAiTurn();
        if (!stoppedByUser) runNextQueuedMobilePrompt();
      },
    });
    const abortHandle = { abort: () => {
      stoppedByUser = true;
      _appendMobileProcess(aiTurn, 'warn', 'Stop requested. Asking the gateway to abort the live runtime.');
      _clearMobileActiveRun(actualSessionId);
      _markMobileSessionRunning(actualSessionId, false);
      stopMobileMainChat(actualSessionId).catch((err) => {
        _appendMobileProcess(aiTurn, 'error', `Backend abort request failed: ${err?.message || err}`);
        renderThreadNow();
      });
      stream.abort();
      finishAiTurn();
    } };
    if (!__pmChat.activeRuns || typeof __pmChat.activeRuns !== 'object') __pmChat.activeRuns = {};
    __pmChat.activeRuns[actualSessionId] = {
      ...(__pmChat.activeRuns[actualSessionId] || {}),
      busy: true,
      abort: abortHandle,
    };
    __pmChat.abort = abortHandle;
  }
  window.__pmMobileSendMessage = sendMessage;

  const runRecoveryOnReturn = () => scheduleMobileRunRecovery(250, { force: true, fullRefresh: true });
  const runRecoveryOnVisibility = () => {
    if (!document.hidden) runRecoveryOnReturn();
  };
  const runRecoveryOnWsOpen = () => scheduleMobileRunRecovery(250, { force: true, fullRefresh: true });
  const onMainChatStreamEvent = (msg = {}) => {
    if (String(msg.sessionId || '') !== requestedSession) return;
    if (__pmChat.activeSessionId !== requestedSession) return;
    const activeThread = _activeMobileThread();
    const incomingClientRequestId = String(msg.data?.clientRequestId || '').trim();
    const eventType = String(msg.event || '');
    if (eventType === 'user_message') {
      const ownClientRequestId = String(__pmChat.sentClientRequestIds?.[requestedSession] || '').trim();
      if (incomingClientRequestId && incomingClientRequestId === ownClientRequestId) return;
      const payload = msg.data?.message && typeof msg.data.message === 'object' ? msg.data.message : {};
      const text = String(payload.content || payload.text || payload.body?.text || '').trim();
      const attachments = Array.isArray(payload.attachmentPreviews)
        ? payload.attachmentPreviews
        : (Array.isArray(payload.body?.attachments) ? payload.body.attachments : []);
      const ts = Number(payload.timestamp || msg.at || Date.now()) || Date.now();
      const previousUser = [...activeThread].reverse().find((turn) => turn?.role === 'user');
      const previousText = String(previousUser?.body?.text || previousUser?.content || '').trim();
      const previousTs = Number(previousUser?.timestamp || 0);
      const isDuplicate = previousUser
        && previousText === text
        && Math.abs(previousTs - ts) < 10000;
      if (!isDuplicate && (text || attachments.length)) {
        activeThread.push({
          role: 'user',
          time: _nowTime(),
          timestamp: ts,
          body: { text, attachments },
          content: text,
          attachmentPreviews: attachments,
          _clientRequestId: incomingClientRequestId,
        });
        _reindexMobileThread(activeThread);
        renderThreadNow();
      }
      _markMobileSessionRunning(requestedSession, true);
      setBusy(true);
      return;
    }
    _markMobileSessionRunning(requestedSession, true);
    let aiTurn = incomingClientRequestId
      ? activeThread.find((turn) => turn?.role === 'ai' && turn.streaming && String(turn._clientRequestId || '') === incomingClientRequestId)
      : null;
    if (!aiTurn) aiTurn = _findLatestAssistantTurn(activeThread);
    if (!aiTurn || !aiTurn.streaming) {
      const rememberedRun = _readMobileActiveRun(requestedSession);
      const recoveredStartedAt = Number(rememberedRun?.startedAt || msg.startedAt || msg.at || 0);
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
        agentExecutionMode: 'execute',
        _clientRequestId: incomingClientRequestId,
      };
      activeThread.push(aiTurn);
    }
    aiTurn.streaming = true;
    const evt = {
      type: String(msg.event || ''),
      ...(msg.data || {}),
      seq: msg.seq,
      streamId: msg.streamId,
      at: msg.at,
    };
    const applied = applyMobileChatStreamEvent(aiTurn, evt);
    if (applied === 'done' || applied === 'error') {
      finalizeMobileLiveAiTurn(aiTurn);
      _clearMobileActiveRun(requestedSession);
      _markMobileSessionRunning(requestedSession, false);
      setBusy(false, requestedSession);
    } else if (applied && applied !== 'duplicate') setBusy(true);
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
    if (evt.type === 'tool_call') {
      const args = _safeJsonPreview(evt.args || evt.params || evt.input);
      _rememberVoiceAgentProcessEntry(sid, {
        type: label.toLowerCase().includes('skill') ? 'skill' : 'tool',
        text: `${label}${args ? `: ${args}` : ''}`,
        extra: evt,
      });
    } else if (evt.type === 'tool_result') {
      const result = _safeJsonPreview(evt.result || evt.output || evt.error || '', 180);
      _rememberVoiceAgentProcessEntry(sid, {
        type: evt.error ? 'error' : 'result',
        text: `${label}${result ? ` -> ${result}` : ' complete'}`,
        extra: evt,
      });
    } else {
      return;
    }
    const activeThread = _activeMobileThread();
    const latestAi = _findLatestAssistantTurn(activeThread);
    if (latestAi && latestAi.streaming) {
      const entries = _takePendingVoiceAgentProcessEntries(sid);
      if (entries.length) {
        latestAi.processEntries = Array.isArray(latestAi.processEntries) ? latestAi.processEntries : [];
        latestAi.processEntries.push(...entries);
        renderThreadSoon();
      }
    }
  };
  window.addEventListener('focus', runRecoveryOnReturn);
  document.addEventListener('visibilitychange', runRecoveryOnVisibility);
  wsEventBus?.on?.('ws:open', runRecoveryOnWsOpen);

  wsEventBus?.on?.('main_chat_stream_event', onMainChatStreamEvent);
  wsEventBus?.on?.('voice_interruption', onVoiceInterruptionEvent);
  wsEventBus?.on?.('voice_agent_tool_event', onVoiceAgentToolEvent);
  const refreshSkillTriggerPill = () => _pmRenderSkillTriggerPill(page, input);
  const previousCleanup = typeof page._pmCleanup === 'function' ? page._pmCleanup : null;
  page._pmCleanup = () => {
    previousCleanup?.();
    window.removeEventListener('focus', runRecoveryOnReturn);
    window.removeEventListener('prometheus:skills-cache-updated', refreshSkillTriggerPill);
    wsEventBus?.off?.('ws:open', runRecoveryOnWsOpen);

    document.removeEventListener('visibilitychange', runRecoveryOnVisibility);
    wsEventBus?.off?.('main_chat_stream_event', onMainChatStreamEvent);
    wsEventBus?.off?.('voice_interruption', onVoiceInterruptionEvent);
    wsEventBus?.off?.('voice_agent_tool_event', onVoiceAgentToolEvent);
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
    chatVoiceClose?.removeEventListener('click', _closeChatVoiceMode);
    chatVoiceHost?._pmCleanup?.();
    body?.classList.remove('pm-chat-voice-occluded');
    _teardownKeyboardController();
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = _pmGetComposerValue(input);
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
    const activeSid = String(__pmChat.activeSessionId || requestedSession || MOBILE_CHAT_SESSION_ID);
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
    resetComposerInput();
    _pmClearActiveSlashCommand(page, input, { focus: false });
    updateComposerSubmitState();
    sendMessage(text);
  });

  threadEl?.addEventListener('click', (event) => {
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

  input?.addEventListener('input', () => {
    resizeComposerInput();
    _pmHandleSlashInput(page, input);
    _pmRenderSkillTriggerPill(page, input);
    updateComposerSubmitState();
  });
  input?.addEventListener('keydown', (e) => {
    const suggestions = _pmSlashCommandSuggestions(input.value);
    const popoverOpen = !page.querySelector('#pm-chat-slash-popover')?.hidden && suggestions.length > 0;
    if (!popoverOpen) {
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        return;
      }
      if (e.key === 'Escape' && pmActiveSlashCommand) {
        e.preventDefault();
        _pmClearActiveSlashCommand(page, input);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      pmSlashCommandSelectionIndex = e.key === 'ArrowDown'
        ? (pmSlashCommandSelectionIndex + 1) % suggestions.length
        : (pmSlashCommandSelectionIndex - 1 + suggestions.length) % suggestions.length;
      _pmRenderSlashPopover(page, input);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      _pmSelectSlashCommand(page, input, suggestions[pmSlashCommandSelectionIndex]?.command || suggestions[0]?.command || '');
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      _pmHideSlashPopover(page);
    }
  });
  input?.addEventListener('blur', () => setTimeout(() => _pmHideSlashPopover(page), 120));
  commandChip?.addEventListener('click', () => _pmClearActiveSlashCommand(page, input));
  window.addEventListener('prometheus:skills-cache-updated', refreshSkillTriggerPill);

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

  attachBtn?.addEventListener('click', openAttachSheet);
  attachSheetScrim?.addEventListener('click', closeAttachSheet);
  attachSheet?.querySelectorAll('[data-pm-attach-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = String(btn.getAttribute('data-pm-attach-action') || '');
      if (action === 'camera') openCameraCapture();
      else if (action === 'files') {
        closeAttachSheet();
        fileInput?.click();
      }
    });
  });
  cameraClose?.addEventListener('click', stopCameraCapture);
  cameraFlip?.addEventListener('click', () => { flipCameraCapture().catch(() => {}); });
  function clearCameraHoldTimer() {
    if (cameraHoldTimer) clearTimeout(cameraHoldTimer);
    cameraHoldTimer = null;
  }
  function beginCameraShutterPress(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!cameraStream || cameraOpening || cameraPointerActive) return;
    cameraPointerActive = true;
    cameraSuppressClick = false;
    clearCameraHoldTimer();
    cameraHoldTimer = setTimeout(() => {
      cameraHoldTimer = null;
      if (!cameraPointerActive) return;
      cameraSuppressClick = true;
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
  fileInput?.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []).slice(0, 8);
    fileInput.value = '';
    if (!files.length) return;
    try {
      const normalized = await Promise.all(files.map(_normalizeMobileFile));
      getPendingAttachments().push(...normalized);
      renderPendingAttachments();
    } catch (err) {
      pmToast(err.message || 'Could not attach file', 'error');
    }
  });

  let chatSpeech = null;
  micBtn?.addEventListener('click', () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      pmToast('Speech dictation is not available in this browser.', 'error');
      return;
    }
    try {
      if (chatSpeech) {
        chatSpeech.stop();
        chatSpeech = null;
        micBtn.classList.remove('listening');
        return;
      }
      const recognition = new SpeechRecognition();
      chatSpeech = recognition;
      recognition.lang = navigator.language || 'en-US';
      recognition.interimResults = true;
      recognition.continuous = false;
      const startValue = String(input.value || '');
      let finalTranscript = '';
      recognition.onstart = () => {
        micBtn.classList.add('listening');
        pmToast('Listening...', 'info');
      };
      recognition.onresult = (event) => {
        let interim = '';
        finalTranscript = '';
        for (let i = 0; i < event.results.length; i++) {
          const transcript = String(event.results[i][0]?.transcript || '');
          if (event.results[i].isFinal) finalTranscript += transcript;
          else interim += transcript;
        }
        input.value = `${startValue}${startValue && (finalTranscript || interim) ? ' ' : ''}${finalTranscript || interim}`.trimStart();
        _pmHandleSlashInput(page, input);
        updateComposerSubmitState();
      };
      recognition.onerror = (event) => {
        const msg = event?.error === 'not-allowed'
          ? 'Microphone permission was denied.'
          : `Dictation failed: ${event?.error || 'unknown error'}`;
        pmToast(msg, 'error');
      };
      recognition.onend = () => {
        micBtn.classList.remove('listening');
        chatSpeech = null;
        input.focus();
        updateComposerSubmitState();
      };
      recognition.start();
    } catch (err) {
      micBtn.classList.remove('listening');
      chatSpeech = null;
      pmToast(err?.message || 'Could not start dictation.', 'error');
    }
  });
}

/* ---------------- VOICE ---------------- */

const PM_VOICE_SETTINGS_KEY = 'pm_voice_settings_v1';
const REALTIME_VOICE_OPTIONS = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];
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
    { id: 'eve', label: 'Eve' },
    { id: 'ara', label: 'Ara' },
    { id: 'rex', label: 'Rex' },
    { id: 'sal', label: 'Sal' },
    { id: 'leo', label: 'Leo' },
  ],
  openai_realtime: REALTIME_VOICE_OPTIONS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) })),
};

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
    const legacyMode =
      saved.voiceMode ||
      (saved.sttProvider === 'openai_realtime' || saved.ttsProvider === 'openai_realtime' ? 'openai_realtime' :
        (saved.sttProvider === 'xai' || saved.ttsProvider === 'xai' ? 'xai' : 'default'));
    const listenMode = ['push_to_speak', 'always_listening'].includes(saved.listenMode) ? saved.listenMode : 'push_to_speak';
    const sttProvider = ['browser', 'openai_realtime', 'xai'].includes(saved.sttProvider)
      ? saved.sttProvider
      : _inputProviderForMode(legacyMode);
    const ttsProvider = ['browser', 'openai_realtime', 'xai'].includes(saved.ttsProvider)
      ? saved.ttsProvider
      : _outputProviderForMode(legacyMode);
    const voiceMode = saved.voiceMode === 'custom' ? 'custom' : _voicePresetForProviders(sttProvider, ttsProvider);
    return {
      voiceMode,
      sttProvider,
      ttsProvider,
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
      voiceAgentRealtimeAgent: saved.voiceAgentRealtimeAgent !== false,
      voiceAgentXaiRealtime: saved.voiceAgentXaiRealtime === true,
    };
  } catch {
    return { voiceMode: 'default', sttProvider: 'browser', ttsProvider: 'browser', realtimeVoice: 'marin', realtimeSpeed: 1.05, serverVoice: '', xaiSpeed: 1.0, dictation: 'quiet', listenMode: 'push_to_speak', wakePhrase: '', wakeGateActive: false, sttProviderLocked: false, autoProviderDefault: '', voiceAgentRealtimeAgent: true, voiceAgentXaiRealtime: false };
  }
}

function _saveVoiceSettings(settings) {
  __pmVoice.settings = { ...__pmVoice.settings, ...settings };
  __pmVoice.dictation = __pmVoice.settings.dictation || __pmVoice.dictation || 'quiet';
  try { localStorage.setItem(PM_VOICE_SETTINGS_KEY, JSON.stringify(__pmVoice.settings)); } catch {}
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
      const result = await mobileGatewayFetch('/api/voice-agent/context', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: sid,
          source: String(options.source || 'mobile_voice_context_prefetch'),
          voiceMode: String(__pmVoice?.settings?.voiceMode || 'default'),
          originalUserPrompt: String(options.originalUserPrompt || ''),
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

function _getMobileVoiceWorkerContextPacketForTurn(sessionId, options = {}) {
  const sid = String(sessionId || 'default').trim() || 'default';
  const cached = _getCachedMobileVoiceWorkerContextPacket(sid);
  if (!cached) _prefetchMobileVoiceWorkerContextPacket(sid, options).catch(() => {});
  return cached;
}

// Persistent voice state across navigation.
const __pmVoice = (window.__pmVoice = window.__pmVoice || {
  recent: [],          // [{id, request, currentTool, finalText, toolStream: [], status, ts, expanded}]
  lastAi: '',          // last final response text
  dictation: 'quiet', // 'quiet' | 'milestone'
  settings: _loadVoiceSettings(),
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
  pendingInterruptContext: null,
  lastInterruptionEvent: null,
  spokenTextSoFar: '',
  currentSpokenSegment: '',
  lastVoiceMilestone: '',
  previewQueue: [],
  activePreview: null,
  previewTimer: null,
});
__pmVoice.settings = { ..._loadVoiceSettings(), ...(__pmVoice.settings || {}) };
if (!['default', 'openai_realtime', 'xai', 'custom'].includes(__pmVoice.settings.voiceMode)) __pmVoice.settings.voiceMode = 'default';
if (!['browser', 'openai_realtime', 'xai'].includes(__pmVoice.settings.sttProvider)) __pmVoice.settings.sttProvider = _inputProviderForMode(__pmVoice.settings.voiceMode);
if (!['browser', 'openai_realtime', 'xai'].includes(__pmVoice.settings.ttsProvider)) __pmVoice.settings.ttsProvider = _outputProviderForMode(__pmVoice.settings.voiceMode);
__pmVoice.dictation = __pmVoice.settings.dictation || __pmVoice.dictation || 'quiet';

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
  if (statusEl) statusEl.textContent = s;
  if (hint != null && hintEl) hintEl.textContent = hint;
}

function _setOrbState(state) {
  const orbEl = document.getElementById('pm-voice-orb');
  if (!orbEl) return;
  orbEl.classList.remove('listening', 'thinking', 'speaking', 'confirmed');
  if (state) orbEl.classList.add(state);
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

function _voiceOrbSvg() {
  return `
    <svg class="pm-orb-svg" viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="pm-orb-core" cx="38%" cy="32%" r="70%">
          <stop offset="0%"  stop-color="#fff6e6" stop-opacity="0.95"/>
          <stop offset="35%" stop-color="#ffd9a8" stop-opacity="0.55"/>
          <stop offset="70%" stop-color="#ea6a1f" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#7a3008" stop-opacity="0.05"/>
        </radialGradient>
        <radialGradient id="pm-orb-glow" cx="50%" cy="50%" r="60%">
          <stop offset="0%"   stop-color="#ffb578" stop-opacity="0.65"/>
          <stop offset="100%" stop-color="#ea6a1f" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="pm-wave-grad" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%"   stop-color="#ea6a1f" stop-opacity="0"/>
          <stop offset="15%"  stop-color="#ea6a1f" stop-opacity="0.9"/>
          <stop offset="50%"  stop-color="#fff3d8" stop-opacity="1"/>
          <stop offset="85%"  stop-color="#ea6a1f" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="#ea6a1f" stop-opacity="0"/>
        </linearGradient>
        <filter id="pm-wave-glow" x="-20%" y="-100%" width="140%" height="300%"><feGaussianBlur stdDeviation="4"/></filter>
      </defs>
      <circle cx="160" cy="160" r="158" fill="url(#pm-orb-glow)"/>
      <circle cx="160" cy="160" r="132" fill="url(#pm-orb-core)"/>
      <g stroke="rgba(234,106,31,0.18)" fill="none" stroke-width="0.6">
        <ellipse cx="160" cy="160" rx="132" ry="42"/>
        <ellipse cx="160" cy="160" rx="132" ry="86"/>
        <ellipse cx="160" cy="160" rx="42" ry="132"/>
        <ellipse cx="160" cy="160" rx="86" ry="132"/>
        <circle cx="160" cy="160" r="132"/>
      </g>
      <path class="pm-wave pm-wave-halo" d="M14 160 Q40 160 56 160 T96 138 T120 175 T142 142 T160 160 T178 178 T200 145 T220 175 T246 160 T268 160 T306 160" fill="none" stroke="url(#pm-wave-grad)" stroke-width="14" stroke-linecap="round" opacity="0.55" filter="url(#pm-wave-glow)"/>
      <path class="pm-wave pm-wave-main" d="M14 160 Q40 160 56 160 T96 138 T120 175 T142 142 T160 160 T178 178 T200 145 T220 175 T246 160 T268 160 T306 160" fill="none" stroke="url(#pm-wave-grad)" stroke-width="2.2" stroke-linecap="round"/>
      <g class="pm-sparkles" fill="#fff3d8">
        <circle cx="92" cy="118" r="1.4"/><circle cx="220" cy="108" r="1.1"/><circle cx="245" cy="210" r="1.6"/><circle cx="88" cy="220" r="1.2"/>
        <circle cx="160" cy="92" r="1.3"/><circle cx="60" cy="170" r="0.9"/><circle cx="260" cy="172" r="1"/><circle cx="180" cy="232" r="1.4"/>
      </g>
    </svg>
  `;
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
  try {
    const data = await loadVoiceVoices(id);
    const voices = Array.isArray(data?.voices) && data.voices.length ? data.voices : _serverVoiceFallback(id);
    __pmVoice.voiceCatalog = { ...(__pmVoice.voiceCatalog || {}), [id]: voices };
    return voices;
  } catch {
    const voices = _serverVoiceFallback(id);
    __pmVoice.voiceCatalog = { ...(__pmVoice.voiceCatalog || {}), [id]: voices };
    return voices;
  }
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

function _speakMobileRealtimeAgentMilestone(text, options = {}) {
  const spoken = _cleanVoiceSpeechText(text);
  const dc = __pmRealtimeAgent?.conn?.dc;
  if (!spoken || __pmVoice.dictation !== 'milestone' || !dc || dc.readyState !== 'open') return;
  if (__pmRealtimeAgent?.quiet?.active) return;
  if (__pmRealtimeAgent?.activeResponse || __pmVoice.realtimeSpeechActiveResponse || __pmVoice.speaking) return;
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
  return await new Promise((resolve, reject) => {
    source.onended = () => {
      if (__pmVoice.audioSource === source) __pmVoice.audioSource = null;
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
    audio.srcObject = event.streams[0];
    audio.play?.().catch((err) => console.warn('[voice] realtime audio play blocked', err));
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
const __pmRealtimeAgent = {
  conn: null,                        // { pc, dc, audio, micStream, micTrack, sessionId, listenMode }
  connecting: null,
  listenMode: 'idle',                // 'idle' | 'push_to_talk' | 'always_listening'
  functionCallBuffers: new Map(),    // call_id -> { name, argsStr }
  // Quiet mode: keep OpenAI STT running but turn create_response off; wake phrase
  // in a completed transcript re-opens the agent. Mirrors the desktop approach.
  quiet: { active: false, wakePhrase: '', wakeNormalized: '', pendingActivate: false, suppressResponse: false },
  contextRefreshTimer: null,
  pendingCreateResponse: null,
  // Camera/photo staging: a captured image is held here (NOT sent to the model)
  // and shown in the chat bubble. It is flushed to the model as an attachment to
  // the user's NEXT spoken turn (flush on speech_started / PTT release), so the
  // user can "take a pic, then say 'look at this'".
  pendingImages: [],                 // [{ dataUrl, name, mimeType, base64 }]
  stagedImageTurn: null,             // the chat bubble holding staged image(s)
  // Per-response tracking for explicit realtime worker hand-offs. Transcript-
  // claim recovery is intentionally disabled: realtime must call the function.
  turn: {
    hadFunctionCall: false,
    dispatchedWorkerThisResponse: false,
    lastUserTranscript: '',
    lastAssistantTranscript: '',
    nudged: false,
    pendingWorkerDispatch: null,
    suppressAssistantTranscript: false,
    finalSummaryPending: false,
  },
};

const MOBILE_REALTIME_HANDOFF_RECOVERY_ENABLED = false;
const MOBILE_REALTIME_HANDOFF_CLAIM_RE = /\b(hand(?:ing|ed)?\s*(?:it|that|this)?\s*off|to the worker|kick(?:ing)?\s*(?:it|that)?\s*off|i('?ve|\s*have)?\s*started|getting started|i'?ll\s*(?:start|get|run|handle|take care)|on it|working on (?:it|that)|in progress|started (?:it|that|the|on)|spun? up|firing up)\b/i;

function _maybeRecoverMobileHallucinatedHandoff() {
  if (!MOBILE_REALTIME_HANDOFF_RECOVERY_ENABLED) return;
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
      __pmRealtimeAgent.submitToWorker(task, { source: 'realtime_agent_dispatch_recovery', skipVoiceAgentHandoff: true });
    }
  } catch (err) {
    _voiceDebug('realtime-agent-handoff-recovery-failed', { message: err?.message || String(err) });
  }
}

function _sendMobileRealtimeAgentCreateResponseFlag(enabled) {
  const dc = __pmRealtimeAgent.conn?.dc;
  if (!dc || dc.readyState !== 'open') return;
  const listenMode = __pmRealtimeAgent.conn?.listenMode || __pmRealtimeAgent.listenMode;
  // Quiet mode (create_response gating) only applies to always-listening server VAD.
  // In push-to-talk there is no turn_detection, so don't reinstate server VAD here.
  if (listenMode !== 'always_listening') return;
  const turnDetection = {
    type: 'server_vad',
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: listenMode === 'always_listening' ? 500 : 800,
    create_response: !!enabled,
  };
  try {
    if (__pmRealtimeAgent.conn?.provider === 'xai') {
      dc.send(JSON.stringify({
        type: 'session.update',
        session: { turn_detection: turnDetection },
      }));
    } else {
      dc.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          audio: {
            input: {
              turn_detection: turnDetection,
              transcription: { model: 'gpt-4o-transcribe' },
            },
          },
        },
      }));
    }
  } catch {}
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
  const dc = __pmRealtimeAgent.conn?.dc;
  if (!dc || dc.readyState !== 'open') return false;
  try {
    dc.send(JSON.stringify({ type: 'response.create' }));
    _voiceDebug('realtime-agent-response-create', { reason });
    return true;
  } catch (err) {
    _voiceDebug('realtime-agent-response-create-failed', { message: err?.message || String(err) });
    return false;
  }
}

function _scheduleMobileRealtimeAgentResponseAfterSkillContext(reason = 'ptt_release') {
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

async function _injectMobileRealtimeAgentSkillContext(sessionId, transcript, options = {}) {
  const dc = __pmRealtimeAgent.conn?.dc;
  const text = String(transcript || '').trim();
  if (!dc || dc.readyState !== 'open' || !text) return false;
  try {
    const data = await mobileGatewayFetch('/api/voice-agent/realtime-skill-context', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        transcript: text,
        maxChars: options.maxChars || 4200,
      }),
    });
    if (!data?.success || !data?.matched || !data?.context) return false;
    dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text: data.context }],
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
  try {
    if (__pmRealtimeAgent.activeResponse) _cancelMobileRealtimeAgentResponseForDispatch();
    try { __pmRealtimeAgent.conn?.playback?.interrupt?.(); } catch {}
    __pmRealtimeAgent.turn.suppressAssistantTranscript = true;
    __pmRealtimeAgent.turn.finalSummaryPending = true;
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
            'Do not read this verbatim. Do not repeat the full worker answer. Summarize the result, outcome, or next useful thing conversationally.',
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
          'Do not duplicate the worker text verbatim.',
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
  return {
    id,
    contextPacketId: id,
    createdAt: pending.startedAt,
    sessionId,
    active: true,
    summary: `The Prometheus worker has just been dispatched and is starting up: ${pending.task}`,
    currentGoal: pending.task,
    currentPhase: 'starting',
    activeToolName: 'dispatch_prometheus_worker',
    activeToolLabel: 'Worker dispatch is starting',
    pendingSteerCount: 0,
    activeRun: null,
    trigger: {
      source: 'realtime_agent_dispatch',
      detail: pending.task,
      startedAt: pending.startedAt,
    },
    currentlyDoing: 'Starting the Prometheus worker for the realtime voice handoff.',
    doneAlready: ['Realtime voice agent sent the task to the Prometheus worker.'],
    observations: [`Pending worker context synthesized locally because the live worker registry has not caught up yet. Reason: ${reason}.`],
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
  if (__pmRealtimeAgent.conn?.provider !== 'xai') {
    try { __pmRealtimeAgent.conn?.dc?.send?.(JSON.stringify({ type: 'output_audio_buffer.clear' })); } catch {}
  }
  try { __pmRealtimeAgent.conn?.playback?.interrupt?.(); } catch {}
  __pmRealtimeAgent.activeResponse = false;
  __pmRealtimeAgent.narrationPending = false;
  __pmRealtimeAgent.lastResponseEndedAt = Date.now();
  __pmVoice.realtimeSpeechActiveResponse = '';
  __pmVoice.speaking = false;
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
  if (__pmRealtimeAgent.conn?.provider !== 'xai') {
    try { __pmRealtimeAgent.conn?.dc?.send?.(JSON.stringify({ type: 'output_audio_buffer.clear' })); } catch {}
  }
  try { __pmRealtimeAgent.conn?.playback?.interrupt?.(); } catch {}
  __pmRealtimeAgent.activeResponse = false;
  __pmVoice.realtimeSpeechActiveResponse = false;
  _sendMobileRealtimeAgentCreateResponseFlag(false);
  pmToast(phrase ? `Quiet mode — say "${phrase}" to wake` : 'Quiet mode on', 'info');
  _setStatus('Quiet mode', phrase ? `Say "${phrase}" to wake Prometheus` : 'Silent until you wake Prometheus');
}

function _deactivateMobileRealtimeAgentQuietMode() {
  if (!__pmRealtimeAgent.quiet.active) return;
  __pmRealtimeAgent.quiet.active = false;
  __pmRealtimeAgent.quiet.pendingActivate = false;
  __pmRealtimeAgent.quiet.suppressResponse = false;
  _saveVoiceSettings({ wakeGateActive: false });
  _sendMobileRealtimeAgentCreateResponseFlag(true);
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
    _cancelMobileRealtimeAgentResponseForDispatch();
    return true; // not woken — suppress transcript display and keep model silent
  }
  _deactivateMobileRealtimeAgentQuietMode();
  pmToast('Awake', 'success');
  const dc = __pmRealtimeAgent.conn?.dc;
  if (dc?.readyState === 'open') {
    try { dc.send(JSON.stringify({ type: 'response.create' })); } catch {}
  }
  return false;
}

function _isMobileRealtimeAgentMode() {
  const mode = String(__pmVoice?.settings?.voiceMode || '').trim();
  if (mode === 'openai_realtime') return true;
  if (mode === 'xai') return __pmVoice?.settings?.voiceAgentXaiRealtime === true;
  return false;
}

function _wantsMobileXaiRealtime() {
  return String(__pmVoice?.settings?.voiceMode || '').trim() === 'xai'
    && __pmVoice?.settings?.voiceAgentXaiRealtime === true;
}

async function _startMobileRealtimeAgentSession(sessionId, options = {}) {
  if (_wantsMobileXaiRealtime()) return _startMobileXaiRealtimeSession(sessionId, options);
  const sid = String(sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || 'mobile_default').trim() || 'mobile_default';
  const listenMode = String(options.listenMode || 'push_to_talk').trim();
  if (
    __pmRealtimeAgent.conn?.dc?.readyState === 'open'
    && String(__pmRealtimeAgent.conn.sessionId || '').trim() === sid
  ) {
    __pmRealtimeAgent.conn.listenMode = listenMode;
    __pmRealtimeAgent.listenMode = listenMode;
    if (listenMode === 'always_listening') _setMobileRealtimeAgentMicEnabled(true);
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
  if (__pmRealtimeAgent.connecting) return __pmRealtimeAgent.connecting;
  __pmRealtimeAgent.listenMode = listenMode;

  __pmRealtimeAgent.connecting = (async () => {
    _voiceDebug('realtime-agent-bootstrap-start', { sessionId: sid, listenMode });
    const quietState = _syncMobileRealtimeAgentQuietFromSettings();
    const wakePhrase = quietState.wakePhrase;
    const workerContextPacket = await _prefetchMobileVoiceWorkerContextPacket(sid, { source: 'mobile_realtime_bootstrap', force: true });
    const bootstrap = await mobileGatewayFetch('/api/voice-agent/realtime-bootstrap', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: sid,
        voice: String(__pmVoice?.settings?.realtimeVoice || 'marin'),
        speed: Number(__pmVoice?.settings?.realtimeSpeed || 1.05),
        voiceRuntime: wakePhrase
          ? { wakePhrase, wakeGateActive: __pmVoice?.settings?.wakeGateActive === true }
          : undefined,
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
      _voiceDebug('realtime-agent-remote-track', {
        sessionId: sid,
        kind: event.track?.kind || '',
        streamCount: event.streams?.length || 0,
        trackState: event.track?.readyState || '',
      });
      audio.srcObject = event.streams[0];
      audio.play?.().catch(() => {});
    };

    // Reuse the shared warm mic — the SAME stream xAI realtime + the soundwave
    // visualizer use. iOS Safari starves a SECOND concurrent getUserMedia capture
    // (a fresh getUserMedia here gave OpenAI a live-but-silent track), which is why
    // soundwaves animate but VAD/transcription got nothing. xAI works because it
    // shares this mic via _ensureMobileXaiRealtimeMic().
    const micStream = await _ensureMobileXaiRealtimeMic();
    const micTrack = micStream.getAudioTracks()[0];
    micTrack.enabled = listenMode === 'always_listening';
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
    dc.addEventListener('message', (msgEvent) => {
      let event = null;
      try { event = JSON.parse(msgEvent.data); } catch { return; }
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
    const model = String(bootstrap.model || _realtimeSpeechModel || 'gpt-realtime-2').trim();
    const clientSecret = String(bootstrap.clientSecret || '').trim();
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
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    await dcOpen;

    // The backend bootstrap bakes server_vad turn detection into the minted
    // client secret for ALL modes (it never receives listenMode). Re-assert the
    // correct per-mode session config at runtime, exactly as the known-good
    // (pre-camera) path did, or push-to-talk fights server VAD and never
    // produces a clean turn:
    //   always_listening -> server VAD auto-commits + auto-replies.
    //   push_to_speak    -> turn_detection disabled; audio only flows while the
    //                       mic track is enabled (button held), and we manually
    //                       commit + create_response on release.
    try {
      dc.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          audio: {
            input: {
              turn_detection: listenMode === 'always_listening'
                ? {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 500,
                    create_response: !__pmRealtimeAgent.quiet.active,
                  }
                : null,
              transcription: { model: 'gpt-4o-transcribe' },
            },
          },
        },
      }));
      _voiceDebug('realtime-agent-session-update', { sessionId: sid, listenMode, quietActive: __pmRealtimeAgent.quiet.active });
    } catch (err) {
      _voiceDebug('realtime-agent-session-update-failed', { message: err?.message || String(err) });
    }

    __pmRealtimeAgent.conn = { pc, dc, audio, micStream, micTrack, sessionId: sid, listenMode, sharedMic: true };
    if (__pmRealtimeAgent.quiet.active) _sendMobileRealtimeAgentCreateResponseFlag(false);
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
    pc.addEventListener('connectionstatechange', () => {
      if (['closed', 'failed', 'disconnected'].includes(pc.connectionState) && __pmRealtimeAgent.conn?.pc === pc) {
        __pmRealtimeAgent.conn = null;
      }
    });
    logState('ready');
    _voiceDebug('realtime-agent-ready', { sessionId: sid, listenMode });
    return __pmRealtimeAgent.conn;
  })().finally(() => {
    __pmRealtimeAgent.connecting = null;
  });
  return __pmRealtimeAgent.connecting;
}

function _stopMobileRealtimeAgentSession() {
  const conn = __pmRealtimeAgent.conn;
  __pmRealtimeAgent.conn = null;
  __pmRealtimeAgent.connecting = null;
  __pmRealtimeAgent.listenMode = 'idle';
  __pmRealtimeAgent.pendingImages = [];
  __pmRealtimeAgent.stagedImageTurn = null;
  __pmRealtimeAgent.functionCallBuffers.clear();
  _clearMobileRealtimeAgentPendingCreateResponse();
  _stopMobileRealtimeAgentContextRefreshLoop();
  try { conn?.cleanup?.(); } catch {}
  try { conn?.dc?.close(); } catch {}
  try { conn?.pc?.close(); } catch {}
  try { if (conn?.audio) conn.audio.srcObject = null; } catch {}
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
    }
    conn.xaiCapture.sending = !!enabled;
    if (conn.micTrack) conn.micTrack.enabled = true;
    return;
  }
  const track = conn?.micTrack;
  if (!track) return;
  track.enabled = !!enabled;
}

// --- xAI / Grok realtime (WebSocket transport) for mobile -------------------
const MOBILE_XAI_REALTIME_SAMPLE_RATE = 24000;

function _mobileXaiVoice(value) {
  const voices = new Set(['eve', 'ara', 'rex', 'sal', 'leo']);
  const v = String(value || '').trim().toLowerCase();
  return voices.has(v) ? v : 'eve';
}

function _mobileBase64ToInt16(b64) {
  const binary = atob(String(b64 || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
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

function _createMobileXaiPlayback() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate: MOBILE_XAI_REALTIME_SAMPLE_RATE });
  let nextStartTime = 0;
  const sources = new Set();
  return {
    ctx,
    enqueue(int16) {
      if (!int16 || !int16.length) return;
      const float = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float[i] = int16[i] < 0 ? int16[i] / 0x8000 : int16[i] / 0x7fff;
      const buffer = ctx.createBuffer(1, float.length, MOBILE_XAI_REALTIME_SAMPLE_RATE);
      buffer.copyToChannel(float, 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      const startAt = Math.max(ctx.currentTime, nextStartTime);
      src.start(startAt);
      nextStartTime = startAt + buffer.duration;
      sources.add(src);
      src.onended = () => sources.delete(src);
    },
    interrupt() {
      for (const src of sources) { try { src.stop(); } catch {} }
      sources.clear();
      nextStartTime = 0;
    },
    close() { this.interrupt(); try { ctx.close?.(); } catch {} },
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
  const sid = String(sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || 'mobile_default').trim() || 'mobile_default';
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
  const playback = _createMobileXaiPlayback();

  ws.addEventListener('close', (ev) => {
    _voiceDebug('openai-realtime-ws-closed', { code: ev.code, reason: ev.reason, protocol: ws.protocol, model });
  });

  const dcShim = {
    get readyState() { return ws.readyState === WebSocket.OPEN ? 'open' : 'closed'; },
    send: (payload) => { try { if (ws.readyState === WebSocket.OPEN) ws.send(payload); } catch {} },
    close: () => { try { ws.close(); } catch {} },
  };

  ws.addEventListener('message', (msgEvent) => {
    let event = null;
    try { event = JSON.parse(typeof msgEvent.data === 'string' ? msgEvent.data : ''); } catch { return; }
    if (!event) return;
    const type = String(event.type || '');
    if (type === 'response.output_audio.delta' || type === 'response.audio.delta') {
      if (__pmRealtimeAgent) __pmRealtimeAgent.activeResponse = true;
      if (__pmRealtimeAgent?.quiet?.active || __pmRealtimeAgent?.quiet?.suppressResponse) {
        __pmRealtimeAgent.quiet.suppressResponse = true;
        _voiceDebug('openai-realtime-ws-quiet-audio-suppressed', { type });
        return;
      }
      __pmVoice.realtimeSpeechActiveResponse = true;
      const b64 = event.delta || event.audio;
      if (b64) { try { playback.enqueue(_mobileBase64ToInt16(b64)); } catch {} }
      return;
    }
    if (type === 'input_audio_buffer.speech_started') { try { playback.interrupt(); } catch {} }
    if (type === 'error' || type === 'response.error' || /\.error$/.test(type)) {
      const msg = String(event?.error?.message || event?.error || event?.message || JSON.stringify(event)).slice(0, 300);
      _voiceDebug('openai-realtime-ws-error', { type, msg });
      try { pmToast(`OpenAI realtime error: ${msg}`, 'error'); } catch {}
    }
    _handleMobileRealtimeAgentEvent(event, sid).catch(() => {});
  });

  const turnDetection = listenMode === 'always_listening'
    ? { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500, create_response: !__pmRealtimeAgent.quiet.active }
    : null;
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
            transcription: { model: 'gpt-4o-transcribe' },
            turn_detection: turnDetection,
          },
          output: { voice: bootstrap.voice || 'marin' },
        },
      },
    }));
    openAiCapture.ready = true;
    flushPendingOpenAiRealtimeAudio();
  } catch {}

  __pmRealtimeAgent.conn = {
    provider: 'openai_ws', ws, dc: dcShim, pc: null, audio: null, micStream, micTrack, sessionId: sid, listenMode, playback, xaiCapture: openAiCapture,
    cleanup: () => {
      try { processor.disconnect(); } catch {}
      try { source.disconnect(); } catch {}
      try { mutedGain.disconnect(); } catch {}
      try { captureCtx.close?.(); } catch {}
      try { playback.close(); } catch {}
      try { ws.close(); } catch {}
    },
  };
  ws.addEventListener('close', () => { if (__pmRealtimeAgent.conn?.ws === ws) __pmRealtimeAgent.conn = null; });
  _voiceDebug('openai-realtime-ws-ready', { sessionId: sid, listenMode, model });
  return __pmRealtimeAgent.conn;
}

async function _startMobileXaiRealtimeSession(sessionId, options = {}) {
  const sid = String(sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || 'mobile_default').trim() || 'mobile_default';
  if (__pmRealtimeAgent.conn?.dc?.readyState === 'open' && String(__pmRealtimeAgent.conn.sessionId || '').trim() === sid) return __pmRealtimeAgent.conn;
  if (__pmRealtimeAgent.connecting) return __pmRealtimeAgent.connecting;
  const listenMode = String(options.listenMode || 'push_to_talk').trim();
  __pmRealtimeAgent.listenMode = listenMode;

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
    const captureCtx = new AudioCtx({ sampleRate: 16000 });
    const source = captureCtx.createMediaStreamSource(micStream);
    const processor = captureCtx.createScriptProcessor(2048, 1, 1);
    const mutedGain = captureCtx.createGain();
    mutedGain.gain.value = 0;
    const xaiCapture = {
      sending: listenMode === 'push_to_talk' || listenMode === 'always_listening',
      appends: 0,
      nonSilent: 0,
      peakMax: 0,
      sampleRate: Math.round(captureCtx.sampleRate || 16000),
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
      for (let i = 0; i < input.length; i += 64) {
        const a = Math.abs(input[i] || 0);
        if (a > peak) peak = a;
      }
      if (peak > xaiCapture.peakMax) xaiCapture.peakMax = peak;
      if (peak > 0.003) xaiCapture.nonSilent += 1;
      const rate = xaiCapture.sampleRate || 16000;
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
        voice: _mobileXaiVoice(__pmVoice?.settings?.serverVoice || __pmVoice?.settings?.realtimeVoice),
        speed: Number(__pmVoice?.settings?.xaiSpeed || 1.0),
        voiceRuntime: wakePhrase ? { wakePhrase, wakeGateActive: __pmVoice?.settings?.wakeGateActive === true } : undefined,
        ...(workerContextPacket ? { contextPacket: workerContextPacket } : {}),
      }),
    });
    if (!bootstrap?.success) throw new Error(bootstrap?.error || 'xAI realtime bootstrap failed');

    // Single subprotocol entry only — xAI negotiates the wrong protocol if extras
    // (e.g. 'realtime') are offered, which silently breaks session config/auth.
    const ws = new WebSocket(bootstrap.wsUrl, [`xai-client-secret.${bootstrap.clientSecret}`]);
    ws.binaryType = 'arraybuffer';
    xaiCapture.ws = ws;
    const playback = _createMobileXaiPlayback();

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
      send: (payload) => { try { if (ws.readyState === WebSocket.OPEN) ws.send(payload); } catch {} },
      close: () => { try { ws.close(); } catch {} },
    };

    ws.addEventListener('message', (msgEvent) => {
      let event = null;
      try { event = JSON.parse(typeof msgEvent.data === 'string' ? msgEvent.data : ''); } catch { return; }
      if (!event) return;
      const type = String(event.type || '');
      if (type === 'response.output_audio.delta' || type === 'response.audio.delta') {
        if (__pmRealtimeAgent) __pmRealtimeAgent.activeResponse = true;
        if (__pmRealtimeAgent?.quiet?.active || __pmRealtimeAgent?.quiet?.suppressResponse) {
          __pmRealtimeAgent.quiet.suppressResponse = true;
          _voiceDebug('xai-realtime-quiet-audio-suppressed', { type });
          return;
        }
        __pmVoice.realtimeSpeechActiveResponse = true;
        const b64 = event.delta || event.audio;
        if (b64) { try { playback.enqueue(_mobileBase64ToInt16(b64)); } catch {} }
        return;
      }
      if (type === 'input_audio_buffer.speech_started') { try { playback.interrupt(); } catch {} }
      if (type === 'error' || type === 'response.error' || /\.error$/.test(type)) {
        const msg = String(event?.error?.message || event?.error || event?.message || JSON.stringify(event)).slice(0, 300);
        _voiceDebug('xai-realtime-error', { type, msg });
        try { pmToast(`xAI realtime error: ${msg}`, 'error'); } catch {}
      }
      _handleMobileRealtimeAgentEvent(event, sid).catch(() => {});
    });

    const turnDetection = listenMode === 'always_listening'
      ? { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500, create_response: !__pmRealtimeAgent.quiet.active }
      : null;
    try {
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['audio', 'text'],
          instructions: bootstrap.instructions,
          voice: bootstrap.voice,
          audio: {
            input: { format: { type: 'audio/pcm', rate: xaiCapture.sampleRate || 16000 } },
            output: { format: { type: 'audio/pcm', rate: MOBILE_XAI_REALTIME_SAMPLE_RATE } },
          },
          input_audio_transcription: { model: 'grok-stt' },
          turn_detection: turnDetection,
        },
      }));
      xaiCapture.ready = true;
      flushPendingXaiRealtimeAudio();
      if (Array.isArray(bootstrap.tools) && bootstrap.tools.length) {
        try { ws.send(JSON.stringify({ type: 'session.update', session: { tools: bootstrap.tools, tool_choice: 'auto' } })); } catch {}
      }
    } catch {}

    __pmRealtimeAgent.conn = {
      provider: 'xai', ws, dc: dcShim, pc: null, audio: null, micStream, micTrack, sessionId: sid, listenMode, playback, xaiCapture,
      cleanup: () => {
        try { processor.disconnect(); } catch {}
        try { source.disconnect(); } catch {}
        try { mutedGain.disconnect(); } catch {}
        try { captureCtx.close?.(); } catch {}
        try { playback.close(); } catch {}
        try { ws.close(); } catch {}
      },
    };
    ws.addEventListener('close', () => { if (__pmRealtimeAgent.conn?.ws === ws) __pmRealtimeAgent.conn = null; });
    _voiceDebug('xai-realtime-ready', { sessionId: sid, listenMode });
    return __pmRealtimeAgent.conn;
  })().finally(() => {
    __pmRealtimeAgent.connecting = null;
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
  const turn = role === 'user'
    ? {
        role: 'user',
        streaming: true,
        time: '',
        timestamp: Date.now(),
        body: { text: '', source: 'voice' },
        content: '',
        source: 'voice_agent_realtime',
      }
    : {
        role: 'ai',
        streaming: true,
        time: '',
        timestamp: Date.now(),
        body: { sender: 'Prometheus', text: '' },
        content: '',
        source: 'voice_agent_realtime',
      };
  __pmChat.threads[sid].push(turn);
  __pmRealtimeAgent.turn[key] = turn;
  return turn;
}

function _finalizeMobileRealtimeAgentChatTurn(sessionId, role, text) {
  const sid = String(sessionId || '').trim();
  const turn = _ensureMobileRealtimeAgentChatTurn(sid, role);
  if (!turn) return null;
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
  turn.time = _nowTime();
  turn.timestamp = Number(turn.timestamp || Date.now()) || Date.now();
  return turn;
}

async function _handleMobileRealtimeAgentEvent(event, sessionId) {
  const type = String(event?.type || '');
  _voiceDebug('realtime-agent-event', {
    type,
    info: type === 'error' ? (event?.error?.message || event?.error) : (event?.transcript ?? event?.delta ?? undefined),
    itemType: event?.item?.type || '',
    responseStatus: event?.response?.status || '',
    keys: event && typeof event === 'object' ? Object.keys(event).slice(0, 12) : [],
  });
  if (type === 'response.created') {
    __pmRealtimeAgent.activeResponse = true;
    if (__pmRealtimeAgent.quiet.active) {
      __pmRealtimeAgent.quiet.suppressResponse = true;
      try { __pmRealtimeAgent.conn?.playback?.interrupt?.(); } catch {}
      _voiceDebug('realtime-agent-quiet-response-suppressed', { type });
      return;
    }
    __pmRealtimeAgent.turn.hadFunctionCall = false;
    __pmRealtimeAgent.turn.dispatchedWorkerThisResponse = false;
    __pmRealtimeAgent.turn.lastAssistantTranscript = '';
    __pmRealtimeAgent.turn.liveUserTranscript = '';
    __pmRealtimeAgent.turn.mobileAssistantTurn = null;
    return;
  }
  if (type === 'response.output_item.added' && event.item?.type === 'function_call') {
    __pmRealtimeAgent.turn.hadFunctionCall = true;
    const callId = String(event.item.call_id || '').trim();
    if (callId) __pmRealtimeAgent.functionCallBuffers.set(callId, { name: String(event.item.name || ''), argsStr: '' });
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
    await _executeMobileRealtimeAgentFunctionCall({ call_id: callId, name, args }, sessionId);
    return;
  }
  if (type === 'conversation.item.input_audio_transcription.delta') {
    const delta = String(event.delta || event.transcript || '').trim();
    if (delta) {
      __pmRealtimeAgent.turn.liveUserTranscript = `${__pmRealtimeAgent.turn.liveUserTranscript || ''}${delta}`;
      _voiceDebug('realtime-agent-user-transcript-delta', { textLen: String(__pmRealtimeAgent.turn.liveUserTranscript || '').length });
    }
    return;
  }
  if (type === 'conversation.item.input_audio_transcription.completed') {
    const transcript = String(event.transcript || event.text || event.delta || __pmRealtimeAgent.turn.liveUserTranscript || '').trim();
    if (transcript) {
      if (_handleMobileRealtimeAgentQuietTranscript(transcript)) {
        __pmRealtimeAgent.turn.liveUserTranscript = '';
        return;
      }
      if (transcript === String(__pmRealtimeAgent.turn.lastUserTranscript || '').trim()) return;
      __pmRealtimeAgent.turn.lastUserTranscript = transcript;
      __pmRealtimeAgent.turn.liveUserTranscript = '';
      __pmRealtimeAgent.turn.nudged = false;
      _voiceDebug('realtime-agent-user-transcript', { transcript });
      // Surface what the user said in the main chat thread (display-only).
      try {
        const sid = sessionId;
        const staged = __pmRealtimeAgent.stagedImageTurn;
        if (staged && Array.isArray(__pmChat.threads?.[sid]) && __pmChat.threads[sid].includes(staged)) {
          // The user just spoke about a staged photo — attach the transcript to the
          // photo bubble so the image + caption show as one user message.
          staged.body = staged.body || { text: '', attachments: [] };
          staged.body.text = transcript;
          staged.content = transcript;
          staged.streaming = false;
          staged.staged = false;
          staged.time = _nowTime();
          __pmRealtimeAgent.stagedImageTurn = null;
        } else {
          _finalizeMobileRealtimeAgentChatTurn(sid, 'user', transcript);
        }
        _persistMobileThreadSnapshot(sid);
        _renderRecent();
        _renderMobileChatSessionNow(sid);
        _notifyMobileChatVoiceUpdate(sid, { reason: 'realtime_user_transcript', force: true });
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
  if (type === 'response.audio_transcript.delta' || type === 'response.output_audio_transcript.delta') {
    if (__pmRealtimeAgent.quiet.active || __pmRealtimeAgent.quiet.suppressResponse || __pmRealtimeAgent.turn.suppressAssistantTranscript) return;
    const delta = String(event.delta || event.transcript || '').trim();
    if (delta) {
      const turn = _ensureMobileRealtimeAgentChatTurn(sessionId, 'ai');
      if (turn) {
        turn.body.text = `${turn.body?.text || ''}${delta}`;
        turn.content = String(turn.body.text || '');
        _notifyMobileChatVoiceUpdate(sessionId, { reason: 'realtime_assistant_transcript_delta' });
      }
    }
    return;
  }
  if (type === 'response.audio_transcript.done' || type === 'response.output_audio_transcript.done') {
    if (__pmRealtimeAgent.quiet.active || __pmRealtimeAgent.quiet.suppressResponse || __pmRealtimeAgent.turn.suppressAssistantTranscript) return;
    const transcript = _cleanVoiceSpeechText(event.transcript || '');
    if (transcript) {
      __pmRealtimeAgent.turn.lastAssistantTranscript = transcript;
      if (__pmRealtimeAgent.turn.dispatchedWorkerThisResponse) {
        _removeMobileRealtimeAgentChatTurn(sessionId, 'ai', transcript);
        __pmRealtimeAgent.turn.mobileAssistantTurn = null;
        return;
      }
      _voiceDebug('realtime-agent-assistant-transcript', { transcript });
      // Append to chat thread for visibility
      try {
        const sid = sessionId;
        _finalizeMobileRealtimeAgentChatTurn(sid, 'ai', transcript);
        __pmRealtimeAgent.turn.mobileAssistantTurn = null;
        _persistMobileThreadSnapshot(sid);
        _renderRecent();
        _renderMobileChatSessionNow(sid);
        _notifyMobileChatVoiceUpdate(sid, { reason: 'realtime_assistant_transcript', force: true });
      } catch {}
    }
    return;
  }
  if (type === 'response.done' || type === 'response.audio.done' || type === 'response.output_audio.done' || type === 'response.cancelled') {
    __pmRealtimeAgent.activeResponse = false;
    __pmRealtimeAgent.quiet.suppressResponse = false;
    if (__pmRealtimeAgent.turn.finalSummaryPending) {
      __pmRealtimeAgent.turn.finalSummaryPending = false;
      __pmRealtimeAgent.turn.suppressAssistantTranscript = false;
      _markVoiceSpeakingEnd();
    }
    __pmRealtimeAgent.narrationPending = false;
    __pmRealtimeAgent.lastResponseEndedAt = Date.now();
    __pmRealtimeAgent.turn.mobileUserTurn = null;
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
    if (type === 'input_audio_buffer.speech_started' && __pmRealtimeAgent.pendingImages.length) {
      _flushMobileRealtimeAgentPendingImages('speech_started').catch(() => {});
    }
    _voiceDebug('realtime-agent-audio-buffer-event', { type, itemId: event?.item_id || '', previousItemId: event?.previous_item_id || '' });
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

    dispatch_prometheus_worker: 'Hand off to Worker',
    steer_active_worker: 'Steer Worker',
    interrupt_active_worker: 'Interrupt Worker',
  };
  const label = map[name] || name.replace(/^voice_/, '').replace(/_/g, ' ');
  const detail = String(args?.query || args?.task || args?.message || args?.phrase || args?.url || args?.reason || '').trim();
  return detail ? `${label}: ${detail.slice(0, 80)}` : label;
}

// Show every realtime tool call in the voice page "recent commands" list (not just
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

async function _abortMobileActiveWorkerFromRealtime(sessionId, source = 'realtime_agent_interrupt') {
  const sid = String(sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || '').trim();
  if (!sid) return false;
  let requested = false;
  const run = __pmChat.activeRuns?.[sid] || __pmChat.activeRuns?.[__pmChat.activeSessionId];
  try {
    if (run?.abort && typeof run.abort.abort === 'function') {
      run.abort.abort();
      requested = true;
    }
  } catch {}
  try {
    const result = await stopMobileMainChat(sid, source);
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
  const args = call?.args && typeof call.args === 'object' ? call.args : {};
  _voiceDebug('realtime-agent-tool-call', { name, args });

  if (name === 'dispatch_prometheus_worker') {
    const task = String(args.task || '').trim();
    let dispatched = false;
    if (task) {
      try {
        if (typeof __pmRealtimeAgent.submitToWorker === 'function') {
          __pmRealtimeAgent.turn.dispatchedWorkerThisResponse = true;
          _cancelMobileRealtimeAgentResponseForDispatch();
          _removeMobileRealtimeAgentChatTurn(sessionId, 'user', task || __pmRealtimeAgent.turn.lastUserTranscript);
          _markMobileRealtimeAgentWorkerDispatch(sessionId, task);
          // Runs the proven voice→worker path: pushes the user turn, creates a
          // recent command, streams the worker response into the chat thread, and
          // starts the realtime narration/context loop for live milestone updates.
          __pmRealtimeAgent.submitToWorker(task, { source: 'realtime_agent_dispatch', skipVoiceAgentHandoff: true });
          dispatched = true;
          setTimeout(() => _refreshMobileRealtimeAgentWorkerContext('worker_dispatched_fast'), 300);
          setTimeout(() => _refreshMobileRealtimeAgentWorkerContext('worker_dispatched'), 1200);
        } else {
          _voiceDebug('realtime-agent-dispatch-no-bridge', {});
        }
      } catch (err) {
        _voiceDebug('realtime-agent-dispatch-failed', { message: err?.message || String(err) });
      }
    }
    _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({
      ok: dispatched,
      dispatched,
      task,
      spoken_confirmation_not_needed: true,
      note: 'Worker dispatch has started through the chat worker bridge. Do not speak another handoff acknowledgement.',
    }), { createResponse: false });
    return;
  }
  if (name === 'steer_active_worker') {
    const message = String(args.message || '').trim();
    let ok = false;
    let error = '';
    if (_isMobileVoiceStatusQuestion(message)) {
      try {
        const status = await mobileGatewayFetch('/api/voice-agent/realtime-tool', {
          method: 'POST',
          body: JSON.stringify({ sessionId, toolName: 'voice_worker_status', toolArgs: { include_recent_events: true } }),
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
        _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({ ok: true, steered: false, statusQuestion: true, workerStatus: _overlayPendingMobileRealtimeAgentWorkerPacket(status?.result || null, sessionId, 'blocked_status_as_steer_output') || null }));
      } catch (err) {
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
    _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({ ok, steered: ok, message, error }));
    return;
  }
  if (name === 'interrupt_active_worker') {
    try { await _abortMobileActiveWorkerFromRealtime(sessionId, 'realtime_agent_interrupt'); } catch {}
    _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({ ok: true, interrupted: true, reason: String(args.reason || '') }));
    return;
  }

  const recentCmd = _addRealtimeAgentRecentCommand(name, args);
  try {
    const contextPacket = name === 'voice_worker_status'
      ? _overlayPendingMobileRealtimeAgentWorkerPacket(
        _getCachedMobileVoiceWorkerContextPacket(sessionId),
        sessionId,
        'voice_worker_status_tool_client_context',
      )
      : null;
    const result = await mobileGatewayFetch('/api/voice-agent/realtime-tool', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        toolName: name,
        toolArgs: args,
        ...(contextPacket ? { contextPacket } : {}),
      }),
    });
    if (!result?.success) {
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
          ? result.result
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
          __pmChat.threads[sid].push({
            role: 'ai',
            streaming: false,
            time: _nowTime(),
            timestamp: Date.now(),
            body: { sender: 'Prometheus', text: '' },
            content: '',
            richArtifacts: voiceArtifacts,
            source: 'voice_agent_realtime',
            channel: 'voice',
          });
          _renderMobileChatSessionNow(sid);
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
  const dc = __pmRealtimeAgent.conn?.dc;
  if (!dc || dc.readyState !== 'open' || !callId) return;
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
                detail: 'auto',
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

// Inject one image into the realtime conversation as a user item, with NO
// response.create. Done at STAGE time (when the audio buffer is idle) — injecting
// while the user is actively speaking races the auto-response and the model ends
// up "not seeing" the image. Verified: an image item added while idle is visible
// to a later spoken/typed turn's response.
async function _injectRealtimeImageItemToConversation(img, label) {
  if (!img || img.realtimeInjected) return false;
  const dc = __pmRealtimeAgent.conn?.dc;
  if (!dc || dc.readyState !== 'open') return false;
  if (String(__pmRealtimeAgent.conn?.provider || 'openai_realtime') === 'xai') return false;
  try {
    const imageUrl = await _downscaleDataUrlForRealtime(img.dataUrl);
    if (__pmRealtimeAgent.conn?.dc?.readyState !== 'open') return false;
    __pmRealtimeAgent.conn.dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: label || 'Image captured from the mobile camera. Keep it in view and use it as visual context for what I say next.' },
          { type: 'input_image', detail: 'auto', image_url: imageUrl },
        ],
      },
    }));
    img.realtimeInjected = true;
    _voiceDebug('realtime-agent-image-injected-at-stage', { name: img.name });
    return true;
  } catch (err) {
    _voiceDebug('realtime-agent-image-inject-failed', { message: err?.message || String(err) });
    return false;
  }
}

// xAI voice/realtime models can't take image input. When the user captures media
// on xAI voice, summarize it with Grok (grok-4.3) vision the moment it's captured
// and inject the text summary into the live xAI voice session — so it's ready
// before the user finishes speaking (no wait). One photo = one summary; a video's
// sampled frames are summarized together as one clip.
async function _kickoffMobileXaiVisionSummary(dataUrls, opts = {}) {
  if (String(__pmRealtimeAgent.conn?.provider || 'openai_realtime') !== 'xai') return;
  const urls = (Array.isArray(dataUrls) ? dataUrls : [dataUrls])
    .map((u) => String(u || '').trim())
    .filter((u) => u.startsWith('data:image'));
  if (!urls.length) return;
  const isVideo = urls.length > 1;
  try {
    const reqBody = isVideo
      ? { frames: urls.map((u) => ({ dataUrl: u })), durationMs: Number(opts.durationMs || 0) || 0, name: String(opts.name || 'camera video') }
      : { dataUrl: urls[0], name: String(opts.name || 'camera photo') };
    const res = await mobileGatewayFetch('/api/voice-agent/xai-vision-summary', { method: 'POST', body: JSON.stringify(reqBody) });
    const summary = String(res?.summary || '').trim();
    if (!summary) { _voiceDebug('realtime-agent-xai-summary-empty', { error: res?.error || '' }); return; }
    const dc = __pmRealtimeAgent.conn?.dc;
    if (!dc || dc.readyState !== 'open' || String(__pmRealtimeAgent.conn?.provider) !== 'xai') return;
    dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: `[Visual context from my camera ${isVideo ? 'video clip' : 'photo'}, described by Grok vision since you can't see images directly]: ${summary}\nTreat this as what I'm showing you and keep it in mind for what I say next.`,
        }],
      },
    }));
    _voiceDebug('realtime-agent-xai-summary-injected', { isVideo, summaryLen: summary.length });
  } catch (err) {
    _voiceDebug('realtime-agent-xai-summary-failed', { message: err?.message || String(err) });
    try { pmToast('Could not summarize the image for Grok voice.', 'error'); } catch {}
  }
}

// Stage a captured photo: show it in the chat bubble AND inject it into the
// realtime conversation now (no response). The user's next spoken/typed turn is
// what triggers the model's response — so the image is "attached" to what they say.
function _stageMobileRealtimeAgentImage(attachment, sessionId) {
  const dataUrl = String(attachment?.dataUrl || '').trim();
  if (!dataUrl) return false;
  const sid = String(sessionId || __pmRealtimeAgent.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || 'mobile_default').trim() || 'mobile_default';
  const img = {
    dataUrl,
    name: String(attachment?.name || 'Camera snapshot').trim(),
    mimeType: String(attachment?.mimeType || 'image/jpeg'),
    base64: String(attachment?.base64 || dataUrl.replace(/^data:[^;]+;base64,/, '')),
    realtimeInjected: false,
  };
  __pmRealtimeAgent.pendingImages.push(img);
  // Inject into the realtime session immediately (audio idle → reliable).
  _injectRealtimeImageItemToConversation(img).catch(() => {});
  const previewAttachment = { kind: 'image', name: img.name, mimeType: img.mimeType, dataUrl: img.dataUrl, base64: img.base64, sizeLabel: '' };
  try {
    if (!__pmChat.threads[sid]) __pmChat.threads[sid] = [];
    let turn = __pmRealtimeAgent.stagedImageTurn;
    if (turn && __pmChat.threads[sid].includes(turn)) {
      turn.body.attachments = [...(turn.body.attachments || []), previewAttachment];
    } else {
      turn = {
        role: 'user', streaming: true, staged: true, time: '', timestamp: Date.now(),
        body: { text: '', source: 'voice', attachments: [previewAttachment] },
        attachmentPreviews: [previewAttachment], content: '', source: 'voice_agent_realtime',
      };
      __pmChat.threads[sid].push(turn);
      __pmRealtimeAgent.stagedImageTurn = turn;
    }
    turn.attachmentPreviews = turn.body.attachments;
    _persistMobileThreadSnapshot(sid);
    _renderMobileChatSessionNow(sid);
    _renderRecent();
    _notifyMobileChatVoiceUpdate(sid, { reason: 'realtime_image_staged', force: true });
  } catch {}
  try { pmToast('Photo ready — say what you want to know about it.', 'success'); } catch {}
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
  const dc = __pmRealtimeAgent.conn?.dc;
  if (!dc || dc.readyState !== 'open') return false;
  const provider = String(__pmRealtimeAgent.conn?.provider || 'openai_realtime');
  const all = images.slice();
  __pmRealtimeAgent.pendingImages = [];
  if (provider === 'xai') {
    // xAI voice models can't take images directly — handled by a separate summary
    // workflow (grok). Nothing to inject into the realtime session here.
    _voiceDebug('realtime-agent-image-flush-skip-xai', { count: all.length, reason });
    return false;
  }
  // Most images are already injected at STAGE time (when audio was idle). Only
  // send the ones that weren't (e.g. captured before the data channel was open).
  const toSend = all.filter((im) => !im.realtimeInjected);
  try {
    const promptText = String(options.promptText || '').trim();
    for (let i = 0; i < toSend.length; i++) {
      const imageUrl = await _downscaleDataUrlForRealtime(toSend[i].dataUrl);
      if (__pmRealtimeAgent.conn?.dc?.readyState !== 'open') break;
      __pmRealtimeAgent.conn.dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                toSend.length > 1 ? `Attached image ${i + 1} of ${toSend.length}.` : 'Attached image from the mobile camera.',
                promptText && i === 0 ? `User message: ${promptText}` : 'Use it as visual context for the user\'s next voice/chat turn.',
              ].filter(Boolean).join('\n'),
            },
            { type: 'input_image', detail: 'auto', image_url: imageUrl },
          ],
        },
      }));
      toSend[i].realtimeInjected = true;
    }
    _voiceDebug('realtime-agent-image-flushed', { count: toSend.length, reason });
    if (options.createResponse === true && __pmRealtimeAgent.conn?.dc?.readyState === 'open') {
      __pmRealtimeAgent.conn.dc.send(JSON.stringify({
        type: 'response.create',
        response: {
          output_modalities: ['audio'],
          instructions: promptText
            ? 'Use the attached mobile camera image and the user message. Do not say no image was sent unless the image input is actually absent.'
            : 'Use the attached mobile camera image directly. Do not claim the image was saved to the phone.',
        },
      }));
    }
    return true;
  } catch (err) {
    _voiceDebug('realtime-agent-image-flush-failed', { message: err?.message || String(err) });
    return false;
  }
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
    if (provider === 'xai') {
      const vision = await mobileGatewayFetch('/api/voice-agent/xai-vision-summary', {
        method: 'POST',
        body: JSON.stringify({ dataUrl, name }),
      });
      const summary = String(vision?.summary || '').trim();
      if (!summary) throw new Error(vision?.error || 'xAI vision returned no camera summary.');
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                `Mobile camera snapshot from the app: ${name}.`,
                'xAI vision summary of the snapshot:',
                summary,
                'Use this visual context in the live voice conversation. Do not claim the image was saved to the phone.',
              ].join('\n'),
            },
          ],
        },
      }));
      dc.send(JSON.stringify({ type: 'response.create' }));
      __pmRealtimeAgent.enqueuePreviews?.([{ kind: 'image', name, dataUrl, mimeType: fileLike?.mimeType || 'image/jpeg' }], { transient: true });
      _voiceDebug('xai-realtime-agent-camera-summary-sent', { name, summaryLen: summary.length });
      return true;
    }
    const snapshotImageUrl = await _downscaleDataUrlForRealtime(dataUrl);
    dc.send(JSON.stringify({
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
            detail: 'auto',
            image_url: snapshotImageUrl,
          },
        ],
      },
    }));
    if (provider === 'xai') {
      dc.send(JSON.stringify({ type: 'response.create' }));
    } else {
      dc.send(JSON.stringify({
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
      }));
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
      const vision = await mobileGatewayFetch('/api/voice-agent/xai-vision-summary', {
        method: 'POST',
        body: JSON.stringify({ frames, durationMs, name: 'mobile camera video frames' }),
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
                'xAI vision summary of the sampled frames:',
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
            { type: 'input_image', detail: 'auto', image_url: frame.dataUrl },
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
  if (!__pmRealtimeAgent.conn) {
    _startMobileRealtimeAgentSession(sessionId, { listenMode: 'push_to_talk' })
      .then(() => _setMobileRealtimeAgentMicEnabled(true))
      .catch((err) => _voiceDebug('realtime-agent-ptt-start-failed', { message: err?.message || String(err) }));
    return;
  }
  _setMobileRealtimeAgentMicEnabled(true);
}

function _mobileRealtimeAgentPttRelease() {
  const conn = __pmRealtimeAgent.conn;
  const commitAndRespond = () => {
    const dc = __pmRealtimeAgent.conn?.dc;
    if (dc?.readyState === 'open') {
      try {
        dc.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        if (conn?.provider === 'xai') {
          dc.send(JSON.stringify({ type: 'response.create' }));
        } else {
          _scheduleMobileRealtimeAgentResponseAfterSkillContext('ptt_release');
        }
      } catch {}
    }
  };
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
    setTimeout(() => {
      commitAndRespond();
      _setMobileRealtimeAgentMicEnabled(false);
    }, 180);
    return;
  }
  _setMobileRealtimeAgentMicEnabled(false);
  // Flush any staged photo into the conversation BEFORE committing the audio +
  // creating the response, so the image is attached to this spoken turn.
  if (__pmRealtimeAgent.pendingImages.length) {
    _flushMobileRealtimeAgentPendingImages('ptt_release').finally(() => commitAndRespond());
  } else {
    commitAndRespond();
  }
}

async function _mobileRealtimeAgentEnableAlwaysListening(sessionId) {
  await _startMobileRealtimeAgentSession(sessionId, { listenMode: 'always_listening' });
  _setMobileRealtimeAgentMicEnabled(true);
}

function _mobileRealtimeAgentDisableAlwaysListening() {
  _stopMobileRealtimeAgentSession();
}

// Streaming TTS dispatcher used for chunk-by-chunk speech as the voice agent
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
    const xaiVoice = String(__pmVoice?.settings?.serverVoice || __pmVoice?.provider?.ttsVoice || 'eve').trim();
    const useUrl = ttsProvider === 'xai' && !_isIosSafariBrowser();
    const buildChunkBody = (chunk) => {
      const b = { provider: ttsProvider, text: chunk };
      if (ttsProvider === 'openai' && __pmVoice?.provider?.ttsVoice) b.voice = __pmVoice.provider.ttsVoice;
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
  text = _cleanVoiceSpeechText(text);
  if (!text) return;
  __pmVoice.currentSpokenSegment = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
  const mode = String(__pmVoice.settings?.voiceMode || 'default');
  const outputProvider = String(__pmVoice.settings?.ttsProvider || __pmVoice.provider?.ttsProvider || _outputProviderForMode(mode));
  _voiceDebug('tts-start', { textLen: String(text || '').length, mode, provider: outputProvider });
  const explicitVoiceMode = outputProvider === 'openai_realtime' || outputProvider === 'xai';
  const wantsRealtime = outputProvider === 'openai_realtime';
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
      if (explicitVoiceMode) return;
    }
  }
  const xaiTtsConfigured = Array.isArray(__pmVoice.voiceStatus?.ttsProviders)
    && __pmVoice.voiceStatus.ttsProviders.some(p => p?.id === 'xai' && p?.configured);
  const xaiDisabled = !!(typeof window !== 'undefined' && window.__pmDisableXaiTts);
  const wantsXai = outputProvider === 'xai';
  const providersToTry = (wantsXai && xaiTtsConfigured && !xaiDisabled) ? ['xai'] : [];
  try { console.log('[voice] xai TTS gate split-routing', { mode, outputProvider, xaiTtsConfigured, willTry: providersToTry }); } catch {}
  _voiceDebug('tts-gate', { mode, provider: outputProvider, xaiTtsConfigured, wantsXai, providersToTry });
  for (const ttsProvider of providersToTry) {
    try {
      _voiceSetStatus('Speaking with xAI / Grok', 'Grok voice audio is generating the response');
      _markVoiceSpeakingStart(text);
      const xaiSpeed = Number(__pmVoice.settings?.xaiSpeed || __pmVoice.provider?.speed || 1.0);
      const xaiVoice = String(__pmVoice.settings?.serverVoice || __pmVoice.provider?.ttsVoice || 'eve').trim();
      const useUrl = ttsProvider === 'xai' && !_isIosSafariBrowser();
      const buildChunkBody = (chunk) => {
        const b = { provider: ttsProvider, text: chunk };
        if (ttsProvider === 'openai' && __pmVoice.provider?.ttsVoice) b.voice = __pmVoice.provider.ttsVoice;
        if (ttsProvider === 'xai' && xaiVoice) b.voiceId = xaiVoice;
        if (ttsProvider === 'xai') b.speed = xaiSpeed;
        if (useUrl) b.delivery = 'url';
        return b;
      };
      // Split into sentence-sized chunks and pipeline fetch+play so the first
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
      _voiceDebug('tts-fetch-start', { provider: ttsProvider, voiceId: xaiVoice, delivery: useUrl ? 'url' : 'base64', chunks: chunks.length });
      let nextFetch = synthesizeVoiceAudio(buildChunkBody(chunks[0]));
      for (let ci = 0; ci < chunks.length; ci++) {
        const audio = await nextFetch;
        if (ci + 1 < chunks.length) nextFetch = synthesizeVoiceAudio(buildChunkBody(chunks[ci + 1]));
        _voiceDebug('tts-fetch-ok', { provider: ttsProvider, chunk: ci, mimeType: audio?.mimeType || '', hasBase64: !!audio?.audioBase64, hasUrl: !!(audio?.audioUrl || audio?.url) });
        await _playAudioBase64({ ...audio, playbackRate: ttsProvider === 'xai' ? xaiSpeed : 1 });
      }
      _voiceDebug('tts-play-ok', { provider: ttsProvider });
      return;
    } catch (err) {
      console.warn(`[voice] server TTS failed for ${ttsProvider}, falling back`, err);
      _voiceDebug('tts-error', { provider: ttsProvider, message: err?.message || String(err) });
      pmToast(err.message || `${ttsProvider} voice failed`, 'error');
      _voiceSetStatus('Audio failed', `${ttsProvider === 'xai' ? 'xAI / Grok' : ttsProvider} could not play this response`);
      _markVoiceSpeakingEnd();
      if (explicitVoiceMode) return;
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
    utter.onend   = () => { _markVoiceSpeakingEnd(); };
    utter.onerror = () => { _markVoiceSpeakingEnd(); };
    synth.speak(utter);
  } catch (err) { console.warn('[voice] TTS failed', err); }
}

function _ttsStop() {
  try { window.speechSynthesis?.cancel(); } catch {}
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

function _persistMobileThreadSnapshot(sessionId) {
  const sid = String(sessionId || '').trim();
  const thread = sid ? __pmChat.threads?.[sid] : null;
  if (!sid || !Array.isArray(thread)) return;
  updateMobileChatSessionHistory(sid, _mobileHistoryForServer(thread)).catch((err) => {
    console.warn('[mobile voice] failed to persist interruption chat state:', err);
  });
}

function _setMobileSteerContinuationTurn(sourceTurn, continuationTurn) {
  if (!sourceTurn || !continuationTurn) return;
  try {
    Object.defineProperty(sourceTurn, '_steerContinuationTurn', {
      value: continuationTurn,
      configurable: true,
      writable: true,
    });
  } catch {
    sourceTurn._steerContinuationTurn = continuationTurn;
  }
}

function _mobileStreamTargetTurn(aiTurn) {
  return aiTurn?._steerContinuationTurn || aiTurn;
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
        : shouldAbort
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

  stopMobileMainChat(sid).catch((err) => {
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
      transcript: text,
      userInterruptionTranscript: text,
      source: 'mobile_voice_live_steer',
      voiceMode: String(__pmVoice.settings?.voiceMode || 'default'),
      realtimeAgent: _isMobileRealtimeAgentMode(),
      clientRequestId: String(activeVoice?.activeRequestId || ''),
      voiceRuntime: wakePhrase ? { wakePhrase, wakeGateActive: __pmVoice.settings?.wakeGateActive === true } : undefined,
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

async function _prepareVoiceAgentHandoff(sessionId, transcript = '') {
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
      transcript: text,
      userInterruptionTranscript: text,
      source: 'mobile_voice_handoff',
      voiceMode: String(__pmVoice.settings?.voiceMode || 'default'),
      realtimeAgent: _isMobileRealtimeAgentMode(),
      voiceRuntime: wakePhrase ? { wakePhrase, wakeGateActive: __pmVoice.settings?.wakeGateActive === true } : undefined,
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
    const alreadySpoken = !!result?.streamedSpeech && !!streamingDispatcher;
    _applyVoiceRuntimeDirectives(result, { deferAfterReply: true });
    _voiceDebug('voice-agent-endpoint', {
      sessionId: sid,
      action: result?.action || '',
      elapsedMs: Date.now() - handoffStartedAt,
      timings: result?.timings || null,
    });
    const reply = String(result?.voiceReply || '').trim();
    const voiceProcessEntries = _voiceAgentProcessEntriesFromResult(sid, result);
    if (result?.action === 'handoff_new_work') {
      if (reply) {
        if (!__pmChat.threads[sid]) __pmChat.threads[sid] = [];
        const thread = __pmChat.threads[sid];
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
            processEntries: voiceProcessEntries,
            voiceInterruptionEventId: eventId || undefined,
          });
          _persistMobileThreadSnapshot(sid);
          _renderRecent();
        }
      }
      if (reply && !alreadySpoken) {
        _voiceDebug('ack-tts-started', { sessionId: sid, elapsedMs: Date.now() - handoffStartedAt, nonBlocking: true });
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

export async function renderVoicePage(page, ctx) {
  const navigate = ctx?.navigate;
  const inlineMode = ctx?.inline === true;
  const inlineSessionId = String(ctx?.inlineChatSessionId || '').trim();
  const inlineSessionLabel = String(ctx?.inlineChatSessionLabel || '').trim();
  const header = inlineMode ? '' : renderMobileHeader({
    title: 'Voice Control',
    online: true,
    hideTitle: true,
    rightActions: `<button class="pm-icon-btn" data-action="new-chat" aria-label="New voice chat">${ICONS.plus}</button>`,
  });
  page.innerHTML = `
    ${header}
    <div class="pm-body">

      <section class="pm-voice-stage">
        <div id="pm-voice-preview-host" class="pm-voice-preview-host" aria-live="polite"></div>
        <div class="pm-voice-orb" id="pm-voice-orb" aria-hidden="true">${_voiceOrbSvg()}</div>
        <div class="pm-voice-status" id="pm-voice-status">Ready</div>
        <div class="pm-voice-hint"   id="pm-voice-hint">Tap and hold the mic to speak</div>

        <div id="pm-voice-approval" class="pm-voice-approval" hidden aria-live="polite" aria-label="Approval required">
          <div class="pm-va-header">
            <span class="pm-va-icon">!</span>
            <span class="pm-va-title">Approval Required</span>
            <span class="pm-va-risk" id="pm-va-risk"></span>
          </div>
          <div class="pm-va-tool" id="pm-va-tool"></div>
          <div class="pm-va-action" id="pm-va-action"></div>
          <div class="pm-va-detail" id="pm-va-detail" hidden></div>
          <div class="pm-va-section" id="pm-va-path-host" hidden>
            <div class="pm-va-section-label">Requested path</div>
            <div class="pm-va-path-val" id="pm-va-path-val"></div>
          </div>
          <div class="pm-va-section" id="pm-va-boundary-host" hidden>
            <div class="pm-va-section-label">External paths</div>
            <pre class="pm-va-boundary-val" id="pm-va-boundary-val"></pre>
          </div>
          <div class="pm-va-section" id="pm-va-files-host" hidden>
            <div class="pm-va-section-label">Files</div>
            <div class="pm-va-files-val" id="pm-va-files-val"></div>
          </div>
          <div class="pm-va-section" id="pm-va-reasoning-host" hidden>
            <div class="pm-va-section-label">Reasoning</div>
            <div class="pm-va-reasoning-val" id="pm-va-reasoning-val"></div>
          </div>
          <details class="pm-va-section pm-va-collapsible" id="pm-va-evidence-host" hidden>
            <summary>Evidence</summary>
            <pre class="pm-va-evidence-val" id="pm-va-evidence-val"></pre>
          </details>
          <details class="pm-va-section pm-va-collapsible" id="pm-va-plan-host" hidden>
            <summary>Plan</summary>
            <pre class="pm-va-plan-val" id="pm-va-plan-val"></pre>
          </details>
          <details class="pm-va-section pm-va-collapsible" id="pm-va-workflow-host" hidden>
            <summary>Expected workflow</summary>
            <pre class="pm-va-workflow-val" id="pm-va-workflow-val"></pre>
          </details>
          <div class="pm-va-section" id="pm-va-final-host" hidden>
            <div class="pm-va-section-label" id="pm-va-final-kind"></div>
            <div class="pm-va-final-target" id="pm-va-final-target"></div>
          </div>
          <div class="pm-va-terminal-host" id="pm-va-terminal-host" hidden></div>
          <details class="pm-va-technical" id="pm-va-technical" hidden>
            <summary>Technical details</summary>
            <pre class="pm-va-args" id="pm-va-args"></pre>
          </details>
          <div class="pm-va-btns">
            <button type="button" class="pm-va-btn reject" id="pm-va-reject">Reject</button>
            <button type="button" class="pm-va-btn approve" id="pm-va-approve">Approve</button>
            <button type="button" class="pm-va-btn session" id="pm-va-session" hidden>This session</button>
            <button type="button" class="pm-va-btn always" id="pm-va-always" hidden>Always allow</button>
          </div>
        </div>
        <button type="button" class="pm-voice-mic pm-voice-wave-ptt" id="pm-voice-mic" aria-label="Hold to talk">
          <span class="pm-voice-wave-ambient" aria-hidden="true"></span>
          <span class="pm-voice-wave-line" aria-hidden="true"></span>
          <canvas class="pm-voice-wave-canvas" id="pm-voice-wave-canvas"></canvas>
        </button>
        <div id="pm-voice-provider-banner" style="margin-top:14px;font-size:12px;color:var(--pm-muted);"></div>
        <button id="pm-voice-session-target" type="button" style="margin-top:8px;border:1px solid var(--pm-border);background:var(--pm-bg-soft);color:var(--pm-text-soft);border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Target: resolving latest chat...</button>
        <div id="pm-voice-settings-panel" style="display:none;margin-top:10px;width:min(100%,430px);text-align:left;background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:12px;padding:10px;box-sizing:border-box;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <label style="font-size:11px;font-weight:800;color:var(--pm-muted);text-transform:uppercase;grid-column:1 / -1;">Voice Mode
              <select id="pm-voice-mode-provider" style="margin-top:4px;width:100%;border:1px solid var(--pm-border);border-radius:8px;padding:7px;background:var(--pm-surface-strong);color:var(--pm-text);color-scheme:light dark;"></select>
            </label>
            <label style="font-size:11px;font-weight:800;color:var(--pm-muted);text-transform:uppercase;grid-column:1 / -1;">Listen Mode
              <select id="pm-voice-listen-mode" style="margin-top:4px;width:100%;border:1px solid var(--pm-border);border-radius:8px;padding:7px;background:var(--pm-surface-strong);color:var(--pm-text);color-scheme:light dark;">
                <option value="push_to_speak">Push to Speak</option>
                <option value="always_listening">Always listening</option>
              </select>
            </label>
            <label id="pm-voice-realtime-agent-label" style="display:none;grid-column:1 / -1;font-size:11px;font-weight:800;color:var(--pm-muted);text-transform:uppercase;">
              <input type="checkbox" id="pm-voice-realtime-agent" style="margin-right:6px;vertical-align:middle;" />
              Realtime end-to-end agent (audio in → model → audio out, no gateway voice agent)
            </label>
            <label id="pm-voice-xai-realtime-label" style="display:none;grid-column:1 / -1;font-size:11px;font-weight:800;color:var(--pm-muted);text-transform:uppercase;">
              <input type="checkbox" id="pm-voice-xai-realtime" style="margin-right:6px;vertical-align:middle;" />
              Use xAI Realtime (live Grok speech-to-speech over WebSocket)
            </label>
            <label id="pm-voice-server-voice-label" style="display:none;font-size:11px;font-weight:800;color:var(--pm-muted);text-transform:uppercase;">Response Voice
              <select id="pm-voice-server-voice" style="margin-top:4px;width:100%;border:1px solid var(--pm-border);border-radius:8px;padding:7px;background:var(--pm-surface-strong);color:var(--pm-text);color-scheme:light dark;"></select>
            </label>
            <label id="pm-voice-realtime-voice-label" style="display:none;font-size:11px;font-weight:800;color:var(--pm-muted);text-transform:uppercase;">OpenAI Voice
              <select id="pm-voice-realtime-voice" style="margin-top:4px;width:100%;border:1px solid var(--pm-border);border-radius:8px;padding:7px;background:var(--pm-surface-strong);color:var(--pm-text);color-scheme:light dark;"></select>
            </label>
            <label id="pm-voice-speed-control" style="display:none;font-size:11px;font-weight:800;color:var(--pm-muted);text-transform:uppercase;">Speed <span id="pm-voice-speed-label"></span>
              <input id="pm-voice-speed" type="range" min="0.75" max="1.3" step="0.05" style="margin-top:7px;width:100%;" />
            </label>
            <button id="pm-voice-advanced-toggle" type="button" class="pm-btn ghost" style="grid-column:1 / -1;padding:7px 11px;font-size:12px;">Advanced voice routing</button>
            <div id="pm-voice-advanced-panel" style="display:none;grid-column:1 / -1;border-top:1px solid var(--pm-border);padding-top:9px;margin-top:2px;">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <label style="font-size:11px;font-weight:800;color:var(--pm-muted);text-transform:uppercase;">Input
                  <select id="pm-voice-input-provider" style="margin-top:4px;width:100%;border:1px solid var(--pm-border);border-radius:8px;padding:7px;background:var(--pm-surface-strong);color:var(--pm-text);color-scheme:light dark;">
                    <option value="browser">Browser</option>
                    <option value="openai_realtime">OpenAI Realtime</option>
                    <option value="xai">xAI / Grok</option>
                  </select>
                </label>
                <label style="font-size:11px;font-weight:800;color:var(--pm-muted);text-transform:uppercase;">Output
                  <select id="pm-voice-output-provider" style="margin-top:4px;width:100%;border:1px solid var(--pm-border);border-radius:8px;padding:7px;background:var(--pm-surface-strong);color:var(--pm-text);color-scheme:light dark;">
                    <option value="browser">Browser</option>
                    <option value="openai_realtime">OpenAI Realtime</option>
                    <option value="xai">xAI / Grok</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
        </div>
        <div id="pm-voice-dictation-fallback" style="display:none;margin-top:12px;width:min(100%,420px);">
          <textarea id="pm-voice-dictation-text" rows="3" autocapitalize="sentences" autocomplete="off" placeholder="Tap here, use the iPhone keyboard mic, then send" style="width:100%;box-sizing:border-box;border:1px solid var(--pm-border);border-radius:12px;background:var(--pm-surface-strong);color:var(--pm-text);color-scheme:light dark;padding:10px 12px;font:inherit;font-size:14px;resize:vertical;"></textarea>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;">
            <span id="pm-voice-capability-note" style="font-size:11px;color:var(--pm-muted);line-height:1.35;text-align:left;"></span>
            <button class="pm-btn primary" id="pm-voice-dictation-send" style="padding:7px 14px;font-size:12px;white-space:nowrap;">Send</button>
          </div>
        </div>
      </section>

      <section class="pm-voice-controls">
        <button class="pm-voice-control-btn pm-voice-repeat-btn" id="pm-voice-repeat" type="button" aria-label="Repeat last response" title="Repeat last response">
          ${ICONS.refresh}<span>Repeat last response</span>
        </button>
        <button id="pm-voice-settings-toggle" type="button" class="pm-voice-control-btn pm-voice-settings-icon" aria-label="Voice settings" title="Voice settings">
          ${ICONS.gear}
        </button>
        <div class="pm-voice-mode-toggle" role="group" aria-label="Voice narration mode">
          <button data-mode="quiet"     id="pm-voice-mode-quiet"     type="button">Quiet</button>
          <button data-mode="milestone" id="pm-voice-mode-milestone" type="button">Milestone</button>
        </div>
      </section>

      <section class="pm-recent">
        <div class="pm-recent-head">
          <h3>Recent Commands</h3>
          <a href="#" id="pm-voice-clear" style="cursor:pointer;">Clear</a>
        </div>
        <div class="pm-recent-list" id="pm-voice-recent"></div>
      </section>

    </div>
  `;
  if (!inlineMode) {
    wireHeaderActions(page, {
      onNewChat: () => {
        _startMobileNewVoiceDraft();
        _paintVoiceTarget?.();
        pmToast('New voice chat started', 'success');
      },
    });
  }

  const mic        = page.querySelector('#pm-voice-mic');
  const statusEl   = page.querySelector('#pm-voice-status');
  const hintEl     = page.querySelector('#pm-voice-hint');
  __pmVoice.statusEl = statusEl;
  __pmVoice.hintEl = hintEl;
  const orbEl      = page.querySelector('#pm-voice-orb');
  const banner     = page.querySelector('#pm-voice-provider-banner');
  const settingsToggle = page.querySelector('#pm-voice-settings-toggle');
  const settingsPanel = page.querySelector('#pm-voice-settings-panel');
  const voiceModeSelect = page.querySelector('#pm-voice-mode-provider');
  const listenModeSelect = page.querySelector('#pm-voice-listen-mode');
  const serverVoiceLabel = page.querySelector('#pm-voice-server-voice-label');
  const serverVoiceSelect = page.querySelector('#pm-voice-server-voice');
  const realtimeVoiceLabel = page.querySelector('#pm-voice-realtime-voice-label');
  const realtimeVoiceSelect = page.querySelector('#pm-voice-realtime-voice');
  const speedControl = page.querySelector('#pm-voice-speed-control');
  const speedInput = page.querySelector('#pm-voice-speed');
  const speedLabel = page.querySelector('#pm-voice-speed-label');
  const advancedToggle = page.querySelector('#pm-voice-advanced-toggle');
  const advancedPanel = page.querySelector('#pm-voice-advanced-panel');
  const inputProviderSelect = page.querySelector('#pm-voice-input-provider');
  const outputProviderSelect = page.querySelector('#pm-voice-output-provider');
  const targetBtn  = page.querySelector('#pm-voice-session-target');
  const cameraBtn  = ctx?.cameraButton || page.querySelector('#pm-voice-camera');
  const dictFallback = page.querySelector('#pm-voice-dictation-fallback');
  const dictText = page.querySelector('#pm-voice-dictation-text');
  const dictSend = page.querySelector('#pm-voice-dictation-send');
  const capNote = page.querySelector('#pm-voice-capability-note');
  const recentEl   = page.querySelector('#pm-voice-recent');
  const repeatBtn  = page.querySelector('#pm-voice-repeat');
  const modeQuiet  = page.querySelector('#pm-voice-mode-quiet');
  const modeMile   = page.querySelector('#pm-voice-mode-milestone');
  const clearLink  = page.querySelector('#pm-voice-clear');
  const approvalCard = page.querySelector('#pm-voice-approval');
  const previewHost = page.querySelector('#pm-voice-preview-host');
  const waveCanvas = page.querySelector('#pm-voice-wave-canvas');
  page.querySelector('.pm-voice-controls')?.after(settingsPanel);

  let _activeApprovalId = null;
  let _activeVoiceCommandApprovalId = null;
  let voiceWaveRaf = 0;
  let voiceWaveCtx = null;
  let voiceWaveAudioCtx = null;
  let voiceWaveAnalyser = null;
  let voiceWaveSource = null;
  let voiceWaveStream = null;
  let voiceWaveBins = null;

  function _updateVoiceVisualState() {
    const active = !!(__pmVoice.listening || __pmVoice.speaking || __pmVoice.realtimeSpeechActiveResponse);
    mic?.classList.toggle('speaking', !!(__pmVoice.speaking || __pmVoice.realtimeSpeechActiveResponse));
    mic?.classList.toggle('live', active);
  }

  function _resizeVoiceWaveCanvas() {
    if (!waveCanvas) return;
    const rect = waveCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (waveCanvas.width !== width || waveCanvas.height !== height) {
      waveCanvas.width = width;
      waveCanvas.height = height;
    }
    voiceWaveCtx = voiceWaveCtx || waveCanvas.getContext('2d');
    voiceWaveCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function _connectVoiceWaveAnalyser() {
    if (!waveCanvas || !__pmVoice.listening) return false;
    const stream = __pmVoice.warmMicStream;
    const live = stream?.getAudioTracks?.().some(track => track.readyState === 'live');
    if (!live) return false;
    try {
      if (voiceWaveStream !== stream || !voiceWaveAnalyser) {
        try { voiceWaveSource?.disconnect?.(); } catch {}
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        voiceWaveAudioCtx = voiceWaveAudioCtx || (AudioCtx ? new AudioCtx() : null);
        if (!voiceWaveAudioCtx) return false;
        voiceWaveAnalyser = voiceWaveAudioCtx.createAnalyser();
        voiceWaveAnalyser.fftSize = 256;
        voiceWaveAnalyser.smoothingTimeConstant = 0.72;
        voiceWaveSource = voiceWaveAudioCtx.createMediaStreamSource(stream);
        voiceWaveSource.connect(voiceWaveAnalyser);
        voiceWaveBins = new Uint8Array(voiceWaveAnalyser.frequencyBinCount);
        voiceWaveStream = stream;
      }
      if (voiceWaveAudioCtx?.state === 'suspended') voiceWaveAudioCtx.resume?.().catch?.(() => {});
      return true;
    } catch {
      return false;
    }
  }

  function _drawVoiceWave() {
    if (!waveCanvas) return;
    _resizeVoiceWaveCanvas();
    const ctx2d = voiceWaveCtx;
    if (!ctx2d) return;
    const w = waveCanvas.clientWidth || 1;
    const h = waveCanvas.clientHeight || 1;
    const centerY = h / 2;
    const now = performance.now() / 1000;
    const listening = !!__pmVoice.listening;
    const speaking = !!(__pmVoice.speaking || __pmVoice.realtimeSpeechActiveResponse);
    let liveLevel = 0;
    if (_connectVoiceWaveAnalyser() && voiceWaveAnalyser && voiceWaveBins) {
      voiceWaveAnalyser.getByteFrequencyData(voiceWaveBins);
      const useful = voiceWaveBins.slice(2, 44);
      liveLevel = useful.reduce((sum, value) => sum + value, 0) / Math.max(1, useful.length) / 255;
    }
    const energy = listening ? Math.max(liveLevel, 0.08) : speaking ? 0.42 : 0.04;
    mic?.style.setProperty('--pm-voice-level', String(Math.min(1, energy * 2.1)));
    ctx2d.clearRect(0, 0, w, h);
    const gradient = ctx2d.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, 'rgba(68,118,255,0.16)');
    gradient.addColorStop(0.32, 'rgba(117,77,255,0.76)');
    gradient.addColorStop(0.5, 'rgba(255,225,212,0.96)');
    gradient.addColorStop(0.72, 'rgba(255,92,72,0.92)');
    gradient.addColorStop(1, 'rgba(255,122,47,0.78)');
    ctx2d.fillStyle = gradient;
    ctx2d.shadowBlur = listening || speaking ? 18 : 8;
    ctx2d.shadowColor = listening ? 'rgba(255,105,69,0.72)' : speaking ? 'rgba(255,122,47,0.64)' : 'rgba(255,90,80,0.34)';
    const bars = 48;
    const gap = w / bars;
    const barW = Math.max(2, gap * 0.24);
    for (let i = 0; i < bars; i += 1) {
      const dist = Math.abs(i - bars / 2) / (bars / 2);
      const centerBoost = Math.pow(1 - dist, 2.35);
      const sourceBin = voiceWaveBins ? voiceWaveBins[Math.min(voiceWaveBins.length - 1, Math.floor((i / bars) * voiceWaveBins.length))] / 255 : 0;
      const pulse = (Math.sin(now * (speaking ? 7.2 : 10.5) + i * 0.62) + 1) / 2;
      const jitter = (Math.sin(now * 17 + i * 1.7) + 1) / 2;
      const reactive = listening ? sourceBin : speaking ? pulse * 0.82 : pulse * 0.2;
      const barH = Math.max(2.5, (5 + centerBoost * 34 + reactive * 54 + jitter * energy * 16) * (0.22 + (1 - dist) * 0.78));
      const x = i * gap + gap * 0.32;
      const y = centerY - barH / 2;
      const r = Math.min(barW / 2, barH / 2);
      ctx2d.beginPath();
      ctx2d.roundRect?.(x, y, barW, barH, r);
      if (!ctx2d.roundRect) {
        ctx2d.rect(x, y, barW, barH);
      }
      ctx2d.fill();
    }
    ctx2d.shadowBlur = 0;
    ctx2d.globalAlpha = listening || speaking ? 0.38 : 0.2;
    for (let x = 0; x < w; x += 15) {
      ctx2d.beginPath();
      ctx2d.arc(x, centerY, listening || speaking ? 1.25 : 0.9, 0, Math.PI * 2);
      ctx2d.fill();
    }
    ctx2d.globalAlpha = 1;
    _updateVoiceVisualState();
    voiceWaveRaf = requestAnimationFrame(_drawVoiceWave);
  }

  if (waveCanvas) {
    _resizeVoiceWaveCanvas();
    voiceWaveRaf = requestAnimationFrame(_drawVoiceWave);
    window.addEventListener('resize', _resizeVoiceWaveCanvas);
  }

  function _clearVoicePreviewTimer() {
    if (__pmVoice.previewTimer) {
      clearTimeout(__pmVoice.previewTimer);
      __pmVoice.previewTimer = null;
    }
  }

  function _startVoicePreviewTimer() {
    _clearVoicePreviewTimer();
    const active = __pmVoice.activePreview;
    if (!active) return;
    const remaining = Math.max(250, Number(active.expiresAt || 0) - Date.now());
    const token = active.id;
    __pmVoice.previewTimer = setTimeout(() => {
      if (__pmVoice.activePreview?.id === token) _dequeueVoicePreview({ animate: true });
    }, remaining);
  }

  function _wireVoicePreviewSwipe() {
    const card = previewHost?.querySelector?.('.pm-voice-preview-card');
    if (!card || card.dataset.pmSwipeWired === '1') return;
    card.dataset.pmSwipeWired = '1';
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;
    let dragging = false;
    let didSwipe = false;
    const resetTransform = () => {
      card.style.transition = 'transform .22s cubic-bezier(.2,.9,.2,1), opacity .18s ease';
      card.style.transform = '';
      card.style.opacity = '';
      setTimeout(() => {
        if (!card.classList.contains('leaving')) card.style.transition = '';
      }, 230);
    };
    card.addEventListener('pointerdown', (event) => {
      if (event.button != null && event.button !== 0) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      dx = 0;
      dy = 0;
      dragging = true;
      didSwipe = false;
      card.classList.add('dragging');
      card.style.transition = 'none';
      try { card.setPointerCapture?.(pointerId); } catch {}
    });
    card.addEventListener('pointermove', (event) => {
      if (!dragging || pointerId !== event.pointerId) return;
      dx = event.clientX - startX;
      dy = event.clientY - startY;
      const distance = Math.hypot(dx, dy);
      if (distance < 6) return;
      event.preventDefault();
      const rotate = Math.max(-10, Math.min(10, dx / 18));
      const scale = Math.max(.96, 1 - Math.min(distance, 160) / 2200);
      card.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${rotate}deg) scale(${scale})`;
      card.style.opacity = String(Math.max(.35, 1 - Math.min(distance, 190) / 260));
    }, { passive: false });
    const finish = (event) => {
      if (!dragging || (event?.pointerId != null && pointerId !== event.pointerId)) return;
      dragging = false;
      card.classList.remove('dragging');
      try { card.releasePointerCapture?.(pointerId); } catch {}
      pointerId = null;
      const distance = Math.hypot(dx, dy);
      const velocityDismiss = Math.abs(dx) > 90 || Math.abs(dy) > 76;
      if (distance > 96 || velocityDismiss) {
        didSwipe = true;
        _clearVoicePreviewTimer();
        const width = window.innerWidth || 390;
        const height = window.innerHeight || 844;
        const exitX = Math.abs(dx) > 12 ? Math.sign(dx) * (width + 120) : 0;
        const exitY = Math.abs(dy) > 12 ? Math.sign(dy) * Math.min(height * .72, 620) : -Math.min(height * .72, 620);
        card.style.transition = 'transform .24s ease-out, opacity .22s ease-out';
        card.style.transform = `translate3d(${exitX}px, ${exitY}px, 0) rotate(${Math.max(-18, Math.min(18, dx / 10))}deg) scale(.94)`;
        card.style.opacity = '0';
        setTimeout(() => _dequeueVoicePreview({ animate: false }), 210);
        return;
      }
      resetTransform();
    };
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', finish);
    card.addEventListener('lostpointercapture', finish);
    card.addEventListener('click', (event) => {
      if (!didSwipe) return;
      event.preventDefault();
      event.stopPropagation();
      didSwipe = false;
    }, true);
  }

  function _renderVoicePreviewStack() {
    if (!previewHost) return;
    const active = __pmVoice.activePreview || null;
    const queue = Array.isArray(__pmVoice.previewQueue) ? __pmVoice.previewQueue : [];
    if (!active && !queue.length) {
      previewHost.innerHTML = '';
      previewHost.classList.remove('has-preview');
      return;
    }
    const pending = queue.slice(0, 2);
    const label = active?.transient ? 'Live view' : 'Attached file';
    const ghostHtml = (item, idx) => {
      const media = item?.media || {};
      const src = _mobileMediaUrl(media, 'inline');
      const name = media.name || 'Preview';
      const ghostClass = `pm-voice-preview-ghost ghost-${idx + 1}`;
      if (media.kind === 'image') return `<div class="${ghostClass}" aria-hidden="true"><img src="${escapeHtml(src)}" alt=""></div>`;
      if (media.kind === 'video') return `<div class="${ghostClass}" aria-hidden="true"><video src="${escapeHtml(src)}" muted playsinline preload="metadata"></video></div>`;
      return `<div class="${ghostClass}" aria-hidden="true"><span class="pm-generated-file-icon">${ICONS.clipboard}</span><strong>${escapeHtml(name)}</strong></div>`;
    };
    previewHost.classList.add('has-preview');
    previewHost.innerHTML = `
      ${pending.map(ghostHtml).join('')}
      ${active ? `<div class="pm-voice-preview-card" data-preview-id="${escapeHtml(active.id)}">
        <div class="pm-voice-preview-label">${escapeHtml(label)}</div>
        ${_renderMobileMediaGallery([active.media])}
      </div>` : ''}
    `;
    _wireMobileMediaCards(previewHost);
    _wireVoicePreviewSwipe();
    if (active && !__pmVoice.previewTimer) _startVoicePreviewTimer();
  }

  function _dequeueVoicePreview({ animate = true } = {}) {
    _clearVoicePreviewTimer();
    const currentCard = previewHost?.querySelector?.('.pm-voice-preview-card');
    if (currentCard && animate) currentCard.classList.add('leaving');
    setTimeout(() => {
      __pmVoice.activePreview = null;
      const queue = Array.isArray(__pmVoice.previewQueue) ? __pmVoice.previewQueue : [];
      const next = queue.shift();
      __pmVoice.previewQueue = queue;
      if (next) {
        next.expiresAt = Date.now() + 7000;
        __pmVoice.activePreview = next;
        _renderVoicePreviewStack();
        _startVoicePreviewTimer();
      } else {
        _renderVoicePreviewStack();
      }
    }, currentCard && animate ? 260 : 0);
  }

  function _enqueueVoicePreviews(items, { transient = false } = {}) {
    const media = _normalizeMobileMediaList(items).filter(Boolean);
    if (!media.length) return;
    const queuedKeys = new Set([
      _mobileMediaKey(__pmVoice.activePreview?.media),
      ...(Array.isArray(__pmVoice.previewQueue) ? __pmVoice.previewQueue.map((item) => _mobileMediaKey(item.media)) : []),
    ].filter(Boolean));
    const additions = media
      .filter((item) => {
        const key = _mobileMediaKey(item);
        if (!key || queuedKeys.has(key)) return false;
        queuedKeys.add(key);
        return true;
      })
      .map((item) => ({
        id: `voice_preview_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        media: item,
        transient,
        expiresAt: 0,
      }));
    if (!additions.length) return;
    if (!Array.isArray(__pmVoice.previewQueue)) __pmVoice.previewQueue = [];
    __pmVoice.previewQueue.push(...additions);
    if (!__pmVoice.activePreview) {
      const next = __pmVoice.previewQueue.shift();
      if (next) next.expiresAt = Date.now() + 7000;
      __pmVoice.activePreview = next || null;
      _renderVoicePreviewStack();
      if (next) _startVoicePreviewTimer();
      return;
    }
    _renderVoicePreviewStack();
  }

  function _voicePreviewEventMatchesSession(msg = {}) {
    const target = String(msg.target || '').toLowerCase();
    if (target && target !== 'mobile' && target !== 'all') return false;
    const sid = String(msg.sessionId || '').trim();
    if (!sid) return true;
    const targetSid = String(__pmVoice.targetSessionId || '').trim();
    const activeSid = String(__pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim();
    return sid === targetSid || sid === activeSid;
  }

  const _voiceVisionInjectedHandler = (msg = {}) => {
    if (!_voicePreviewEventMatchesSession(msg)) return;
    const media = _visionEventToMobileMedia(msg);
    if (media) _enqueueVoicePreviews([media], { transient: true });
  };

  const _voiceDeliveryNotificationHandler = (msg = {}) => {
    if (!_voicePreviewEventMatchesSession(msg)) return;
    const media = _deliveryNotificationToMobileMedia(msg);
    if (media) _enqueueVoicePreviews([media], { transient: false });
  };

  wsEventBus?.on?.('vision_injected', _voiceVisionInjectedHandler);
  wsEventBus?.on?.('delivery_notification', _voiceDeliveryNotificationHandler);

  // Bridge: the module-scope realtime agent overlays screenshot previews returned
  // by the realtime-tool endpoint directly onto the orb via this closure function.
  __pmRealtimeAgent.enqueuePreviews = (items, opts) => _enqueueVoicePreviews(items, opts || {});

  function _showVoiceApproval(approval) {
    if (!approvalCard) return;
    _activeApprovalId = approval.id;
    _activeVoiceCommandApprovalId = _pmIsCommandApproval(approval) ? approval.id : null;
    const risk = Number(approval.riskScore || 0);
    const riskLabel = risk >= 7 ? 'High' : risk >= 4 ? 'Medium' : 'Low';
    const riskColor = risk >= 7 ? 'var(--pm-orange)' : risk >= 4 ? '#d6a247' : '#2fae66';
    const human = _pmHumanApproval(approval);
    const technicalText = _pmApprovalTechnicalText(approval);

    approvalCard.querySelector('#pm-va-tool').textContent = human.title;
    approvalCard.querySelector('#pm-va-action').textContent = human.summary;
    const detailEl = approvalCard.querySelector('#pm-va-detail');
    if (detailEl) {
      detailEl.textContent = human.detail || '';
      detailEl.hidden = !human.detail;
    }
    const riskEl = approvalCard.querySelector('#pm-va-risk');
    riskEl.textContent = riskLabel;
    riskEl.style.color = riskColor;
    const argsEl = approvalCard.querySelector('#pm-va-args');
    const techEl = approvalCard.querySelector('#pm-va-technical');
    if (argsEl) argsEl.textContent = technicalText;
    if (techEl) techEl.hidden = !technicalText;
    const terminalHost = approvalCard.querySelector('#pm-va-terminal-host');
    if (terminalHost) {
      terminalHost.innerHTML = '';
      terminalHost.hidden = true;
      terminalHost.dataset.terminalOpen = '0';
    }
    approvalCard.querySelector('#pm-va-session')?.toggleAttribute('hidden', !_pmIsCommandApproval(approval));
    approvalCard.querySelector('#pm-va-always')?.toggleAttribute('hidden', !_pmIsCommandApproval(approval));

    // ── path_access ────────────────────────────────────────────────────────
    const pathHost = approvalCard.querySelector('#pm-va-path-host');
    const pathVal = approvalCard.querySelector('#pm-va-path-val');
    const isPathApproval = String(approval.approvalKind || '').trim() === 'path_access';
    const requestedPath = String(approval.pathAccess?.requestedPath || '').trim();
    if (pathHost) pathHost.hidden = !isPathApproval || !requestedPath;
    if (pathVal) pathVal.textContent = requestedPath;

    // ── command boundary external paths ────────────────────────────────────
    const boundaryHost = approvalCard.querySelector('#pm-va-boundary-host');
    const boundaryVal = approvalCard.querySelector('#pm-va-boundary-val');
    const boundaryPaths = Array.isArray(approval.commandBoundary?.externalPaths)
      ? approval.commandBoundary.externalPaths.filter(Boolean) : [];
    if (boundaryHost) boundaryHost.hidden = !boundaryPaths.length;
    if (boundaryVal) boundaryVal.textContent = boundaryPaths.slice(0, 6).join('\n');

    // ── dev_source_edit ────────────────────────────────────────────────────
    const isDevEdit = String(approval.approvalKind || '').trim() === 'dev_source_edit'
      || String(approval.toolName || '').trim() === 'request_dev_source_edit';
    const devFiles = Array.isArray(approval.devSourceEdit?.allowedFiles) ? approval.devSourceEdit.allowedFiles : [];
    const devPlan = approval.devSourceEdit?.plan || null;
    const devEvidence = Array.isArray(devPlan?.evidence) ? devPlan.evidence : [];
    const devSteps = Array.isArray(devPlan?.steps) ? devPlan.steps : [];
    const devWorkflow = Array.isArray(devPlan?.expectedWorkflow) ? devPlan.expectedWorkflow
      : (Array.isArray(devPlan?.expected_workflow) ? devPlan.expected_workflow : []);
    const devReasoning = String(devPlan?.reasoning || '').trim();

    const filesHost = approvalCard.querySelector('#pm-va-files-host');
    const filesVal = approvalCard.querySelector('#pm-va-files-val');
    if (filesHost) filesHost.hidden = !isDevEdit || !devFiles.length;
    if (filesVal) filesVal.textContent = devFiles.length
      ? `${devFiles.length} file${devFiles.length === 1 ? '' : 's'}: ${devFiles.slice(0, 4).join(', ')}${devFiles.length > 4 ? '…' : ''}`
      : '';

    const reasoningHost = approvalCard.querySelector('#pm-va-reasoning-host');
    const reasoningVal = approvalCard.querySelector('#pm-va-reasoning-val');
    if (reasoningHost) reasoningHost.hidden = !isDevEdit || !devReasoning;
    if (reasoningVal) reasoningVal.textContent = devReasoning;

    const evidenceHost = approvalCard.querySelector('#pm-va-evidence-host');
    const evidenceVal = approvalCard.querySelector('#pm-va-evidence-val');
    if (evidenceHost) evidenceHost.hidden = !isDevEdit || !devEvidence.length;
    if (evidenceVal) evidenceVal.textContent = devEvidence.slice(0, 5)
      .map((e) => `${e.file || 'file'}${e.lines ? `:${e.lines}` : ''} — ${e.finding || ''}`).join('\n');

    const planHost = approvalCard.querySelector('#pm-va-plan-host');
    const planVal = approvalCard.querySelector('#pm-va-plan-val');
    if (planHost) planHost.hidden = !isDevEdit || !devSteps.length;
    if (planVal) planVal.textContent = devSteps.slice(0, 8).map((s, i) => `${i + 1}. ${s}`).join('\n');

    const workflowHost = approvalCard.querySelector('#pm-va-workflow-host');
    const workflowVal = approvalCard.querySelector('#pm-va-workflow-val');
    if (workflowHost) workflowHost.hidden = !isDevEdit || !devWorkflow.length;
    if (workflowVal) workflowVal.textContent = devWorkflow.slice(0, 6).map((s, i) => `${i + 1}. ${s}`).join('\n');

    // ── final_action ───────────────────────────────────────────────────────
    const isFinalAction = String(approval.approvalKind || '').trim() === 'final_action'
      || String(approval.toolName || '').trim() === 'request_final_action_approval';
    const finalKind = String(approval.finalAction?.actionKind || approval.toolArgs?.action_kind || '').trim();
    const finalTarget = String(approval.finalAction?.targetLabel || approval.toolArgs?.target_label || '').trim();
    const finalHost = approvalCard.querySelector('#pm-va-final-host');
    const finalKindEl = approvalCard.querySelector('#pm-va-final-kind');
    const finalTargetEl = approvalCard.querySelector('#pm-va-final-target');
    if (finalHost) finalHost.hidden = !isFinalAction;
    if (finalKindEl) finalKindEl.textContent = finalKind ? finalKind.charAt(0).toUpperCase() + finalKind.slice(1) : 'Action';
    if (finalTargetEl) finalTargetEl.textContent = finalTarget;

    approvalCard.querySelectorAll('.pm-va-btn')?.forEach((btn) => { btn.disabled = false; });
    approvalCard.classList.remove('pm-va-success', 'pm-va-failed', 'pm-va-running');
    approvalCard.style.setProperty('--va-accent', riskColor);
    approvalCard.hidden = false;
    requestAnimationFrame(() => approvalCard.classList.add('pm-va-visible'));
    _setStatus('Waiting for your approval', 'Approve or reject the request below');
  }

  function _hideVoiceApproval() {
    if (!approvalCard) return;
    _activeApprovalId = null;
    _activeVoiceCommandApprovalId = null;
    approvalCard.classList.remove('pm-va-visible');
    setTimeout(() => {
      if (approvalCard && !_activeApprovalId) {
        approvalCard.hidden = true;
        approvalCard.classList.remove('pm-va-success', 'pm-va-failed', 'pm-va-running');
      }
    }, 280);
  }

  const _approveVoiceApproval = async (grantScope = '') => {
    const id = _activeApprovalId;
    if (!id) return;
    const isCommand = !!_activeVoiceCommandApprovalId;
    approvalCard?.querySelectorAll('.pm-va-btn')?.forEach((btn) => { btn.disabled = true; });
    _setStatus(grantScope === 'always' ? 'Always allowed - continuing...' : grantScope === 'session' ? 'Allowed this session - continuing...' : 'Approved - continuing...', '');
    try {
      await approveMobileApproval(id, grantScope);
      if (isCommand) {
        approvalCard?.classList.add('pm-va-running');
        const terminalHost = approvalCard?.querySelector('#pm-va-terminal-host');
        if (terminalHost) {
          terminalHost.hidden = false;
          _pmLoadApprovalProcessRun(id, terminalHost).then(() => _wireMobileProcessRunActions(terminalHost)).catch(() => {});
        }
      } else {
        if (!_activeVoiceCommandApprovalId) _hideVoiceApproval();
      }
    } catch (e) {
      approvalCard?.querySelectorAll('.pm-va-btn')?.forEach((btn) => { btn.disabled = false; });
      pmToast('Approve failed: ' + (e?.message || e), 'error');
    }
  };

  approvalCard?.querySelector('#pm-va-approve')?.addEventListener('click', () => _approveVoiceApproval(''));
  approvalCard?.querySelector('#pm-va-session')?.addEventListener('click', () => _approveVoiceApproval('session'));
  approvalCard?.querySelector('#pm-va-always')?.addEventListener('click', () => _approveVoiceApproval('always'));

  approvalCard?.querySelector('#pm-va-approve-legacy')?.addEventListener('click', async () => {
    const id = _activeApprovalId;
    if (!id) return;
    _hideVoiceApproval();
    _setStatus('Approved — continuing…', '');
    try { await approveMobileApproval(id); } catch (e) { pmToast('Approve failed: ' + (e?.message || e), 'error'); }
  });
  approvalCard?.querySelector('#pm-va-reject')?.addEventListener('click', async () => {
    const id = _activeApprovalId;
    if (!id) return;
    _hideVoiceApproval();
    _setStatus('Rejected', '');
    try { await denyMobileApproval(id); } catch (e) { pmToast('Reject failed: ' + (e?.message || e), 'error'); }
  });

  const _voiceProcessExitHandler = (msg = {}) => {
    const run = msg.run || {};
    if (!approvalCard || !_activeVoiceCommandApprovalId) return;
    if (String(run.approvalId || '') !== String(_activeVoiceCommandApprovalId)) return;
    const ok = Number(run.exitCode) === 0;
    approvalCard.classList.remove('pm-va-running');
    approvalCard.classList.add(ok ? 'pm-va-success' : 'pm-va-failed');
    approvalCard.querySelector('.pm-process-card')?.classList.add(ok ? 'pm-process-success' : 'pm-process-failed');
    approvalCard.style.setProperty('--va-accent', ok ? '#2fae66' : '#d8473a');
    _setStatus(ok ? 'Command succeeded' : 'Command failed', ok ? 'Result is ready below' : 'Review the terminal output below');
    setTimeout(() => {
      if (_activeVoiceCommandApprovalId && String(run.approvalId || '') === String(_activeVoiceCommandApprovalId)) _hideVoiceApproval();
    }, ok ? 2200 : 3600);
  };
  wsEventBus?.on?.('process_run_exited', _voiceProcessExitHandler);
  const _voiceTimerDoneHandler = (msg = {}) => {
    if (msg?.voiceIfActive !== true) return;
    const sid = String(msg.sessionId || msg.timer?.sessionId || '').trim();
    const activeSid = String(__pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim();
    if (sid && activeSid && sid !== activeSid) return;
    const text = String(msg.result || msg.message?.content || '').trim();
    if (!text) return;
    _ttsStop();
    _ttsSpeak(text);
    _setOrbState('speaking');
    _setStatus('Timer complete', 'Prometheus finished the scheduled request');
  };
  wsEventBus?.on?.('timer_done', _voiceTimerDoneHandler);
  const previousVoiceCleanup = typeof page._pmCleanup === 'function' ? page._pmCleanup : null;
  page._pmCleanup = () => {
    previousVoiceCleanup?.();
    if (voiceWaveRaf) {
      cancelAnimationFrame(voiceWaveRaf);
      voiceWaveRaf = 0;
    }
    window.removeEventListener('resize', _resizeVoiceWaveCanvas);
    try { voiceWaveSource?.disconnect?.(); } catch {}
    try { voiceWaveAnalyser?.disconnect?.(); } catch {}
    try { voiceWaveAudioCtx?.close?.(); } catch {}
    voiceWaveSource = null;
    voiceWaveAnalyser = null;
    voiceWaveAudioCtx = null;
    voiceWaveStream = null;
    wsEventBus?.off?.('vision_injected', _voiceVisionInjectedHandler);
    wsEventBus?.off?.('delivery_notification', _voiceDeliveryNotificationHandler);
    wsEventBus?.off?.('process_run_exited', _voiceProcessExitHandler);
    wsEventBus?.off?.('timer_done', _voiceTimerDoneHandler);
    if (inlineMode) {
      __pmVoice.resumeAlwaysListeningOnVoicePage = false;
    }
    if (__pmVoice.listening) {
      if (_isAlwaysListeningMode() && !inlineMode) __pmVoice.resumeAlwaysListeningOnVoicePage = true;
      _stopListening(true);
    }
    if (inlineMode) {
      _releaseWarmMic();
    }
    if (__pmVoice.previewTimer) {
      clearTimeout(__pmVoice.previewTimer);
      __pmVoice.previewTimer = null;
    }
    window.__pmVoiceTargetPicker = null;
    document.removeEventListener('pm-drawer-closed', _onDrawerClosed);
  };

  let _paintVoiceTarget = () => {};

  _paintVoiceTarget = () => {
    const sid = String(__pmVoice.targetSessionId || '').trim();
    const label = String(__pmVoice.targetSessionLabel || sid || 'Latest chat').trim();
    targetBtn.textContent = `Target: ${label}`;
    targetBtn.title = sid ? `${label}\n${sid}` : 'Voice commands will use the latest active chat.';
  };

  if (inlineMode) {
    __pmVoice.targetSessionId = inlineSessionId || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID;
    __pmVoice.targetSessionLabel = inlineSessionLabel || (__pmVoice.targetSessionId === MOBILE_CHAT_SESSION_ID ? 'Mobile - New Chat' : 'Mobile - Chat');
    __pmVoice.targetSessionChannel = 'mobile';
    __pmVoice.targetSessionForced = true;
    if (targetBtn) targetBtn.hidden = true;
    _paintVoiceTarget();
  }

  async function _resolveVoiceSessionTarget({ forceRefresh = false } = {}) {
    const forced = __pmVoice.targetSessionForced && String(__pmVoice.targetSessionId || '').trim();
    if (forced) {
      _paintVoiceTarget();
      return String(__pmVoice.targetSessionId).trim();
    }
    if (!forceRefresh && String(__pmVoice.targetSessionId || '').trim()) {
      _paintVoiceTarget();
      return String(__pmVoice.targetSessionId).trim();
    }
    const latest = await loadLatestUsableSession().catch(() => null);
    if (latest?.id) {
      __pmVoice.targetSessionId = latest.id;
      __pmVoice.targetSessionLabel = _voiceShortSessionLabel(latest);
      __pmVoice.targetSessionChannel = latest.channel || '';
      __pmVoice.targetSessionForced = false;
    } else {
      __pmVoice.targetSessionId = MOBILE_CHAT_SESSION_ID;
      __pmVoice.targetSessionLabel = 'Mobile - New Chat';
      __pmVoice.targetSessionChannel = 'mobile';
      __pmVoice.targetSessionForced = false;
    }
    _paintVoiceTarget();
    return String(__pmVoice.targetSessionId || MOBILE_CHAT_SESSION_ID).trim();
  }

  const _onDrawerClosed = () => { window.__pmVoiceTargetPicker = null; };
  document.addEventListener('pm-drawer-closed', _onDrawerClosed);

  targetBtn.addEventListener('click', () => {
    if (inlineMode) return;
    window.__pmVoiceTargetPicker = async (sessionId) => {
      const sessionData = await loadMobileChatSession(sessionId).catch(() => null);
      __pmVoice.targetSessionId = sessionId;
      __pmVoice.targetSessionLabel = sessionData ? _voiceShortSessionLabel(sessionData) : `Chat - ${sessionId}`;
      __pmVoice.targetSessionChannel = sessionData?.channel || '';
      __pmVoice.targetSessionForced = true;
      _paintVoiceTarget();
      pmToast(`Voice target: ${__pmVoice.targetSessionLabel}`, 'info');
    };
    openDrawer();
  });

  if (!inlineMode) {
    _resolveVoiceSessionTarget({ forceRefresh: !__pmVoice.targetSessionForced }).catch(() => {
      __pmVoice.targetSessionId = __pmVoice.targetSessionId || MOBILE_CHAT_SESSION_ID;
      __pmVoice.targetSessionLabel = __pmVoice.targetSessionLabel || 'Mobile - New Chat';
      _paintVoiceTarget();
    });
  }

  // ── Provider detection ─────────────────────────────────────────────
  function _providerOptionHtml(id, label, selected) {
    return `<option value="${escapeHtml(id)}" ${id === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }

  function _routingProviderReady(provider, kind) {
    const id = String(provider || 'browser');
    if (id === 'browser') return true;
    if (id === 'openai_realtime') return _isRealtimeConnected(__pmVoice.lastVoiceStatus);
    const list = kind === 'input' ? __pmVoice.voiceStatus?.sttProviders : __pmVoice.voiceStatus?.ttsProviders;
    return Array.isArray(list) && list.some(p => p?.configured && p?.id === id);
  }

  function _syncVoicePresetFromRouting() {
    const sttProvider = String(__pmVoice.settings?.sttProvider || 'browser');
    const ttsProvider = String(__pmVoice.settings?.ttsProvider || 'browser');
    const preset = _voicePresetForProviders(sttProvider, ttsProvider);
    _saveVoiceSettings({ voiceMode: preset });
    return preset;
  }

  function _paintVoiceSettings() {
    const settings = __pmVoice.settings || {};
    const sttProviders = Array.isArray(__pmVoice.voiceStatus?.sttProviders) ? __pmVoice.voiceStatus.sttProviders : [];
    const ttsProviders = Array.isArray(__pmVoice.voiceStatus?.ttsProviders) ? __pmVoice.voiceStatus.ttsProviders : [];
    const realtimeReady = _isRealtimeConnected(__pmVoice.lastVoiceStatus);
    const xaiReady = sttProviders.some(p => p?.configured && p?.id === 'xai') && ttsProviders.some(p => p?.configured && p?.id === 'xai');
    const selectedMode = ['default', 'openai_realtime', 'xai', 'custom'].includes(settings.voiceMode) ? settings.voiceMode : _syncVoicePresetFromRouting();
    const outputProvider = String(settings.ttsProvider || _outputProviderForMode(selectedMode));
    const customRoutingSelected = selectedMode === 'custom';
    if (listenModeSelect) listenModeSelect.value = _voiceListenMode();
    // Realtime-agent toggle: only visible when voice mode is openai_realtime
    const realtimeAgentLabel = page.querySelector('#pm-voice-realtime-agent-label');
    const realtimeAgentCheckbox = page.querySelector('#pm-voice-realtime-agent');
    if (realtimeAgentLabel) realtimeAgentLabel.style.display = selectedMode === 'openai_realtime' ? '' : 'none';
    if (realtimeAgentCheckbox) realtimeAgentCheckbox.checked = settings.voiceAgentRealtimeAgent !== false;
    // xAI realtime toggle: only visible when voice mode is xai
    const xaiRealtimeLabel = page.querySelector('#pm-voice-xai-realtime-label');
    const xaiRealtimeCheckbox = page.querySelector('#pm-voice-xai-realtime');
    if (xaiRealtimeLabel) xaiRealtimeLabel.style.display = selectedMode === 'xai' ? '' : 'none';
    if (xaiRealtimeCheckbox) xaiRealtimeCheckbox.checked = settings.voiceAgentXaiRealtime === true;
    voiceModeSelect.innerHTML = [
      _providerOptionHtml('default', 'Default', selectedMode),
      _providerOptionHtml('openai_realtime', `OpenAI Realtime${realtimeReady ? '' : ' (not connected)'}`, selectedMode),
      _providerOptionHtml('xai', `xAI / Grok${xaiReady ? '' : ' (not connected)'}`, selectedMode),
      _providerOptionHtml('custom', 'Custom routing', selectedMode),
    ].join('');
    if (inputProviderSelect) inputProviderSelect.value = String(settings.sttProvider || _inputProviderForMode(selectedMode));
    if (outputProviderSelect) outputProviderSelect.value = outputProvider;
    if (advancedToggle) advancedToggle.style.display = customRoutingSelected ? '' : 'none';
    if (advancedPanel) advancedPanel.style.display = customRoutingSelected ? 'block' : 'none';
    const selectedServerTts = outputProvider === 'xai' && _routingProviderReady('xai', 'output') ? 'xai' : '';
    realtimeVoiceSelect.innerHTML = REALTIME_VOICE_OPTIONS
      .map(id => _providerOptionHtml(id, id[0].toUpperCase() + id.slice(1), settings.realtimeVoice || 'marin'))
      .join('');
    if (realtimeVoiceLabel) realtimeVoiceLabel.style.display = outputProvider === 'openai_realtime' ? '' : 'none';
    if (selectedServerTts && serverVoiceLabel && serverVoiceSelect) {
      serverVoiceLabel.style.display = '';
      serverVoiceSelect.innerHTML = `<option value="">Loading voices...</option>`;
      _loadServerVoiceCatalog(selectedServerTts).then((voices) => {
        const fallback = selectedServerTts === 'xai' ? 'eve' : (selectedServerTts === 'openai' ? 'alloy' : '');
        const stored = settings.serverVoice || fallback;
        const selected = voices.some((voice) => voice.id === stored) ? stored : (voices[0]?.id || '');
        serverVoiceSelect.innerHTML = voices
          .map((voice) => _providerOptionHtml(voice.id, voice.label || voice.name || voice.id, selected))
          .join('');
        serverVoiceSelect.value = selected;
        if (selected && selected !== settings.serverVoice) _saveVoiceSettings({ serverVoice: selected });
        if (__pmVoice.provider) __pmVoice.provider.ttsVoice = selected;
        _paintProviderBanner();
      }).catch(() => {
        const voices = _serverVoiceFallback(selectedServerTts);
        serverVoiceSelect.innerHTML = voices
          .map((voice) => _providerOptionHtml(voice.id, voice.label || voice.id, settings.serverVoice || voice.id))
          .join('');
      });
    } else if (serverVoiceLabel && serverVoiceSelect) {
      serverVoiceLabel.style.display = 'none';
      serverVoiceSelect.innerHTML = '';
    }
    const speedValue = outputProvider === 'xai' ? Number(settings.xaiSpeed || 1.0) : Number(settings.realtimeSpeed || 1.05);
    if (speedControl) speedControl.style.display = ['openai_realtime', 'xai'].includes(outputProvider) ? '' : 'none';
    speedInput.min = outputProvider === 'xai' ? '0.5' : '0.75';
    speedInput.max = outputProvider === 'xai' ? '2' : '1.3';
    speedInput.step = '0.05';
    speedInput.value = String(speedValue);
    speedLabel.textContent = `${Number(speedInput.value).toFixed(2)}x`;
  }

  function _recomputeVoiceProvider() {
    if (__pmVoice.lastVoiceStatus) __pmVoice.provider = _detectProvider(__pmVoice.lastVoiceStatus);
    _paintVoiceSettings();
  }

  function _paintProviderBanner() {
    const p = __pmVoice.provider || _detectProvider(__pmVoice.lastVoiceStatus || {});
    const stt = String(p.sttProvider || __pmVoice.settings?.sttProvider || 'browser');
    const tts = String(p.ttsProvider || __pmVoice.settings?.ttsProvider || 'browser');
    const providerLabel = (id, kind) => {
      if (id === 'openai_realtime') return 'OpenAI Realtime';
      if (id === 'xai') return 'xAI / Grok';
      if (kind === 'input') return 'Browser';
      return 'Device voice';
    };
    let detail = `Input: <strong>${escapeHtml(providerLabel(stt, 'input'))}</strong> - Output: <strong>${escapeHtml(providerLabel(tts, 'output'))}</strong>`;
    if (tts === 'openai_realtime') detail += ` - ${escapeHtml(p.voice || __pmVoice.settings?.realtimeVoice || 'marin')}`;
    if (tts === 'xai') detail += ` - ${escapeHtml(p.ttsVoice || __pmVoice.settings?.serverVoice || 'eve')}`;
    detail += ` - ${_isAlwaysListeningMode() ? 'Always listening' : 'Push to Speak'}`;
    banner.innerHTML = detail;
  }

  settingsToggle.addEventListener('click', () => {
    settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
  });
  voiceModeSelect.addEventListener('change', () => {
    const mode = voiceModeSelect.value || 'default';
    const wasListening = __pmVoice.listening;
    if (mode === 'custom') {
      _saveVoiceSettings({ voiceMode: 'custom', sttProviderLocked: true });
      if (advancedPanel) advancedPanel.style.display = 'block';
      _recomputeVoiceProvider();
      _paintProviderBanner();
      return;
    }
    _saveVoiceSettings({
      voiceMode: mode,
      sttProvider: _inputProviderForMode(mode),
      ttsProvider: _outputProviderForMode(mode),
      serverVoice: mode === 'xai' ? (__pmVoice.settings?.serverVoice || 'eve') : '',
      sttProviderLocked: true,
      autoProviderDefault: '',
    });
    if (mode !== 'openai_realtime') _closeRealtimeSpeechConnection();
    _recomputeVoiceProvider();
    _paintProviderBanner();
    if (wasListening) {
      _stopListening(true);
      if (_isAlwaysListeningMode()) setTimeout(() => _startAlwaysListening(), 250);
    }
  });
  listenModeSelect?.addEventListener('change', () => {
    const listenMode = listenModeSelect.value === 'always_listening' ? 'always_listening' : 'push_to_speak';
    _saveVoiceSettings(listenMode === 'push_to_speak'
      ? { listenMode, wakePhrase: '', wakeGateActive: false, autoProviderDefault: '' }
      : { listenMode, wakeGateActive: false, autoProviderDefault: '' });
    if (listenMode === 'always_listening') {
      pmToast('Always listening enabled', 'success');
      _startAlwaysListening();
    } else {
      pressArm = false;
      mic.classList.remove('pressed');
      if (__pmVoice.listening) _stopListening(true);
      _setReadyVoiceState();
      pmToast('Push to Speak enabled. Wake phrase cleared.', 'info');
    }
    _paintVoiceSettings();
    _paintProviderBanner();
  });
  advancedToggle?.addEventListener('click', () => {
    if (!advancedPanel) return;
    if (String(__pmVoice.settings?.voiceMode || '') !== 'custom') {
      advancedPanel.style.display = 'none';
      return;
    }
    advancedPanel.style.display = advancedPanel.style.display === 'none' ? 'block' : 'none';
  });
  page.querySelector('#pm-voice-realtime-agent')?.addEventListener('change', (ev) => {
    const enabled = ev?.target?.checked !== false;
    if (__pmVoice.listening) _stopListening(true);
    _stopMobileRealtimeAgentSession();
    _saveVoiceSettings({ voiceAgentRealtimeAgent: enabled });
    pmToast(enabled ? 'Realtime end-to-end agent enabled' : 'Realtime agent disabled', 'info');
    _paintProviderBanner();
  });
  page.querySelector('#pm-voice-xai-realtime')?.addEventListener('change', (ev) => {
    const enabled = ev?.target?.checked === true;
    if (__pmVoice.listening) _stopListening(true);
    _stopMobileRealtimeAgentSession();
    _saveVoiceSettings({ voiceAgentXaiRealtime: enabled });
    pmToast(enabled ? 'xAI Realtime enabled' : 'xAI Realtime disabled', 'info');
    _paintProviderBanner();
  });
  const _applyRoutingProviderChange = () => {
    const wasListening = __pmVoice.listening;
    const previousOutput = String(__pmVoice.settings?.ttsProvider || 'browser');
    const sttProvider = String(inputProviderSelect?.value || 'browser');
    const ttsProvider = String(outputProviderSelect?.value || 'browser');
    const preset = _voicePresetForProviders(sttProvider, ttsProvider);
    _saveVoiceSettings({
      sttProvider,
      ttsProvider,
      voiceMode: preset,
      serverVoice: ttsProvider === 'xai' ? (__pmVoice.settings?.serverVoice || 'eve') : __pmVoice.settings?.serverVoice || '',
      sttProviderLocked: true,
      autoProviderDefault: '',
    });
    if (previousOutput === 'openai_realtime' || ttsProvider === 'openai_realtime') _closeRealtimeSpeechConnection();
    _recomputeVoiceProvider();
    _paintProviderBanner();
    if (wasListening) {
      _stopListening(true);
      if (_isAlwaysListeningMode()) setTimeout(() => _startAlwaysListening(), 250);
    }
  };
  inputProviderSelect?.addEventListener('change', _applyRoutingProviderChange);
  outputProviderSelect?.addEventListener('change', _applyRoutingProviderChange);
  serverVoiceSelect?.addEventListener('change', () => {
    _saveVoiceSettings({ serverVoice: serverVoiceSelect.value });
    if (__pmVoice.provider) __pmVoice.provider.ttsVoice = serverVoiceSelect.value;
    _paintProviderBanner();
  });
  realtimeVoiceSelect.addEventListener('change', () => {
    _saveVoiceSettings({ realtimeVoice: realtimeVoiceSelect.value });
    _closeRealtimeSpeechConnection();
    _recomputeVoiceProvider();
    _paintProviderBanner();
  });
  speedInput.addEventListener('input', () => {
    speedLabel.textContent = `${Number(speedInput.value).toFixed(2)}x`;
    const outputProvider = String(__pmVoice.settings?.ttsProvider || _outputProviderForMode(__pmVoice.settings?.voiceMode || 'default'));
    _saveVoiceSettings(outputProvider === 'xai' ? { xaiSpeed: Number(speedInput.value) } : { realtimeSpeed: Number(speedInput.value) });
    _recomputeVoiceProvider();
    _paintProviderBanner();
  });

  let autoStartHandled = false;
  const _runVoiceAutoStart = () => {
    if (autoStartHandled || ctx?.autoStart !== true) return;
    autoStartHandled = true;
    _unlockVoiceAudio();
    if (_isAlwaysListeningMode()) {
      setTimeout(() => _startAlwaysListening(), 0);
    } else {
      pressArm = true;
      mic.classList.add('pressed');
      _ensureWarmMic().catch((err) => {
        _showDictationFallback(err?.message || _voiceCapabilityNote());
        pmToast('Microphone permission is not available', 'error');
      });
      _startListening();
    }
  };

  loadVoiceStatus().then(status => {
    __pmVoice.lastVoiceStatus = status;
    __pmVoice.voiceStatus = status?.voice || null;
    _applyMobileVoiceProviderDefaults(status);
    __pmVoice.provider = _detectProvider(status);
    _paintVoiceSettings();
    _paintProviderBanner();
    _prewarmMobileVoiceWorkerContext({ sessionId: __pmVoice.targetSessionId || __pmChat.activeSessionId, source: 'mobile_voice_page_ready' });
    // If mic permission was already granted in a prior session, warm the mic stream
    // and realtime connection now so the very first PTT press is instant.
    const inputNow = String(__pmVoice.settings?.sttProvider || _inputProviderForMode(__pmVoice.settings?.voiceMode || 'default'));
    if (inputNow === 'openai_realtime' && _isRealtimeConnected(status) && !_isMobileRealtimeAgentMode()) {
      const tryPrewarm = () => _ensureWarmMic().then(() => _prewarmRealtimeConn()).catch(() => {});
      if (navigator.permissions) {
        navigator.permissions.query({ name: 'microphone' })
          .then(r => { if (r.state === 'granted') tryPrewarm(); })
          .catch(() => {});
      }
    }
    if (_isAlwaysListeningMode() && !__pmVoice.listening) {
      __pmVoice.resumeAlwaysListeningOnVoicePage = false;
      // Do not request microphone permission just because the mobile app opened
      // or restored onto the voice page. Always-listening should start only from
      // an explicit user voice action, which passes ctx.autoStart=true.
      if (ctx?.autoStart === true) _runVoiceAutoStart();
      else _setReadyVoiceState();
    } else {
      _runVoiceAutoStart();
    }
    return;
    const p = __pmVoice.provider;
    const mode = String(__pmVoice.settings?.voiceMode || 'default');
    let detail = mode === 'openai_realtime'
      ? (p.id === 'openai_realtime' ? 'Mode: <strong>OpenAI Realtime</strong>' : 'Mode: <strong>Default</strong> · OpenAI Realtime unavailable')
      : mode === 'xai'
        ? (p.id === 'xai' ? 'Mode: <strong>xAI / Grok</strong>' : 'Mode: <strong>Default</strong> · xAI/Grok unavailable')
        : 'Mode: <strong>Default</strong>';
    if (p.id === 'openai_realtime') detail += ` · ${escapeHtml(p.voice || 'marin')}`;
    if (p.id === 'xai') detail += ` · ${escapeHtml(p.ttsVoice || 'eve')}`;
    banner.innerHTML = detail + ` · <a href="#" id="pm-voice-settings" style="color:var(--pm-orange);font-weight:700;text-decoration:none;">Settings ›</a>`;
    page.querySelector('#pm-voice-settings')?.addEventListener('click', e => { e.preventDefault(); navigate?.('#mobile/settings/models'); });
  }).catch(() => {
    banner.textContent = 'Using browser speech';
    _runVoiceAutoStart();
  });

  // ── Dictation mode toggle ─────────────────────────────────────────
  function _setMode(mode) {
    __pmVoice.dictation = mode;
    _saveVoiceSettings({ dictation: mode });
    const active = '#ea6a1f';
    const inactive = 'transparent';
    const activeColor = '#fff';
    const inactiveColor = 'var(--pm-muted)';
    modeQuiet.style.background = mode === 'quiet' ? active : inactive;
    modeQuiet.style.color = mode === 'quiet' ? activeColor : inactiveColor;
    modeMile.style.background  = mode === 'milestone' ? active : inactive;
    modeMile.style.color  = mode === 'milestone' ? activeColor : inactiveColor;
  }
  _setMode(__pmVoice.dictation);
  if (!__pmVoice.listening) _setReadyVoiceState();
  modeQuiet.addEventListener('click', () => _setMode('quiet'));
  modeMile.addEventListener('click',  () => _setMode('milestone'));

  // ── Recent commands rendering ─────────────────────────────────────
  function _renderRecent() {
    if (!__pmVoice.recent.length) {
      recentEl.innerHTML = `<div style="text-align:center;color:var(--pm-muted);font-size:13px;padding:24px 8px;">No commands yet. Hold the mic to start.</div>`;
      return;
    }
    recentEl.innerHTML = __pmVoice.recent.map(cmd => _renderVoiceCard(cmd)).join('');
    recentEl.querySelectorAll('[data-cmd-id]').forEach(cardEl => {
      const id = cardEl.getAttribute('data-cmd-id');
      cardEl.querySelector('[data-toggle]')?.addEventListener('click', () => {
        const cmd = __pmVoice.recent.find(c => c.id === id);
        if (cmd) { cmd.expanded = !cmd.expanded; _renderRecent(); }
      });
      cardEl.querySelector('[data-repeat]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const cmd = __pmVoice.recent.find(c => c.id === id);
        if (cmd?.finalText) _ttsSpeak(cmd.finalText);
      });
    });
    _wireMobileMediaCards(recentEl);
  }

  function _renderVoiceCard(cmd) {
    const tool = cmd.currentTool || (cmd.status === 'thinking' ? 'thinking…' : (cmd.status === 'done' ? 'complete' : 'listening for response…'));
    const expanded = !!cmd.expanded;
    const isFinal = cmd.status === 'done' || cmd.status === 'error';
    const sessionLabel = String(cmd.sessionLabel || '').trim();
    const mediaCount = _collectMessageMedia(cmd).length;
    return `
      <div class="pm-recent-item" data-cmd-id="${cmd.id}" style="flex-direction:column;align-items:stretch;padding:0;overflow:hidden;">
        <button type="button" data-toggle style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:transparent;border:none;padding:12px 14px;cursor:pointer;font-family:inherit;">
          <span class="pm-icon" style="${cmd.status === 'streaming' || cmd.status === 'thinking' ? 'background:var(--pm-orange);color:#fff;' : ''}">${cmd.status === 'streaming' || cmd.status === 'thinking' ? '<span class="pm-mini-spin" style="display:inline-block;width:14px;height:14px;border:2px solid #fff;border-right-color:transparent;border-radius:50%;animation:pm-spin 1s linear infinite;"></span>' : ICONS.micSmall}</span>
          <span class="pm-meta" style="flex:1;min-width:0;">
            <strong style="display:block;font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(cmd.request)}</strong>
            <span class="pm-flip-tool" data-tool="${escapeHtml(tool)}" style="display:block;font-size:12px;color:var(--pm-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(tool)}</span>
            ${sessionLabel ? `<span style="display:block;font-size:11px;color:var(--pm-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Session: ${escapeHtml(sessionLabel)}</span>` : ''}
          </span>
          ${mediaCount && !expanded ? `<span style="font-size:10px;font-weight:700;background:var(--pm-orange);color:#fff;border-radius:999px;padding:2px 7px;white-space:nowrap;">${mediaCount} file${mediaCount > 1 ? 's' : ''}</span>` : ''}
          <span style="color:var(--pm-muted);transition:transform .2s;${expanded ? 'transform:rotate(90deg);' : ''}">${ICONS.chev}</span>
        </button>
        ${expanded ? `
          <div style="padding:0 14px 14px;border-top:1px solid var(--pm-border);background:var(--pm-bg-soft);">
            ${isFinal && cmd.finalText ? `
              <div style="display:flex;justify-content:flex-end;padding:8px 0 4px;">
                <button class="pm-btn primary" data-repeat style="padding:6px 14px;font-size:12px;display:inline-flex;align-items:center;gap:6px;">🔁 Repeat response</button>
              </div>
            ` : ''}
            <div style="margin-top:8px;font-size:11px;font-weight:800;color:var(--pm-orange);text-transform:uppercase;letter-spacing:1.2px;">Request</div>
            <div style="font-size:13px;line-height:1.45;margin-top:4px;">${escapeHtml(cmd.request)}</div>
            ${sessionLabel ? `
              <div style="margin-top:10px;font-size:11px;font-weight:800;color:var(--pm-orange);text-transform:uppercase;letter-spacing:1.2px;">Session</div>
              <div style="font-size:12px;line-height:1.45;margin-top:4px;color:var(--pm-text-soft);">${escapeHtml(sessionLabel)}</div>
            ` : ''}

            ${cmd.toolStream.length ? `
              <div style="margin-top:12px;font-size:11px;font-weight:800;color:var(--pm-orange);text-transform:uppercase;letter-spacing:1.2px;">Tool stream</div>
              <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;">
                ${cmd.toolStream.map(s => `<div style="font-size:12px;font-family:ui-monospace,monospace;color:var(--pm-text-soft);padding:4px 8px;background:#fff;border:1px solid var(--pm-border);border-radius:6px;">${escapeHtml(s)}</div>`).join('')}
              </div>
            ` : ''}

            ${cmd.finalText ? `
              <div style="margin-top:12px;font-size:11px;font-weight:800;color:var(--pm-orange);text-transform:uppercase;letter-spacing:1.2px;">Response</div>
              <div style="font-size:13px;line-height:1.55;margin-top:4px;white-space:pre-wrap;">${escapeHtml(cmd.finalText)}</div>
            ` : ''}
            ${(() => {
              const media = _collectMessageMedia(cmd);
              if (!media.length) return '';
              return `
                <div style="margin-top:14px;font-size:11px;font-weight:800;color:var(--pm-orange);text-transform:uppercase;letter-spacing:1.2px;">Attached files</div>
                <div style="margin-top:8px;">${_renderMobileMediaGallery(media)}</div>
              `;
            })()}
          </div>
        ` : ''}
      </div>
    `;
  }

  _renderRecent();

  // Subtle flip animation hook: when the tool text changes, update DOM in place
  // with a CSS flip rather than full re-render.
  function _updateToolFlip(cmd, newTool) {
    if (cmd.currentTool === newTool) return;
    cmd.currentTool = newTool;
    const cardEl = recentEl.querySelector(`[data-cmd-id="${cmd.id}"]`);
    const toolEl = cardEl?.querySelector('.pm-flip-tool');
    if (!toolEl) { _renderRecent(); return; }
    toolEl.classList.remove('pm-flipping');
    void toolEl.offsetWidth;          // restart anim
    toolEl.classList.add('pm-flipping');
    setTimeout(() => { toolEl.textContent = newTool; }, 110);
  }

  // ── Orb state ─────────────────────────────────────────────────────
  function _setOrbState(state) {
    const target = orbEl || document.getElementById('pm-voice-orb');
    if (target) {
      target.classList.remove('listening', 'thinking', 'speaking', 'confirmed');
      if (state) target.classList.add(state);
    }
    mic?.classList.toggle('recording', state === 'listening');
    mic?.classList.toggle('thinking', state === 'thinking');
    mic?.classList.toggle('confirmed', state === 'confirmed');
    mic?.classList.toggle('speaking', state === 'speaking' || !!__pmVoice.speaking || !!__pmVoice.realtimeSpeechActiveResponse);
    _updateVoiceVisualState();
  }

  // ── Repeat last ───────────────────────────────────────────────────
  function _refreshRepeatBtn() {
    repeatBtn.disabled = !__pmVoice.lastAi;
    repeatBtn.style.opacity = __pmVoice.lastAi ? '' : '0.45';
  }
  _refreshRepeatBtn();
  if (cameraBtn) cameraBtn.onclick = async () => {
    // Live camera -> realtime voice agent. Tap = photo, hold = video (≤12s,
    // sampled ~1 frame/sec). The capture is STAGED (shown in the chat bubble) and
    // attached to the user's next spoken turn — take a pic, then say "look at this".
    // Guard on voice MODE (not an open data channel) so a brief reconnect doesn't
    // wrongly block capture; staged images flush once the session is ready.
    const sid = String(__pmRealtimeAgent.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || 'mobile_default').trim() || 'mobile_default';
    const hasSession = !!(__pmRealtimeAgent.conn || __pmRealtimeAgent.connecting);
    if (!hasSession && !_isMobileRealtimeAgentMode()) {
      pmToast('Start realtime voice first, then take a photo or video.', 'info');
      return;
    }
    const openCamera = ctx?.openCameraCapture;
    if (typeof openCamera !== 'function') {
      pmToast('Camera is only available from the chat voice view.', 'info');
      return;
    }
    try {
      await openCamera({
        target: 'voice',
        onCapture: async (normalized, extra) => {
          const dataUrl = extra?.dataUrl || normalized?.dataUrl || '';
          _stageMobileRealtimeAgentImage({
            dataUrl,
            name: extra?.file?.name || normalized?.name || 'Camera snapshot',
            mimeType: normalized?.mimeType || extra?.file?.type || 'image/jpeg',
            base64: normalized?.base64,
          }, sid);
          // xAI voice: summarize via Grok now (no-op for OpenAI, which got the image directly).
          _kickoffMobileXaiVisionSummary([dataUrl], { name: 'camera photo' }).catch(() => {});
        },
        onVideoCapture: async (payload) => {
          const frames = Array.isArray(payload?.frames) ? payload.frames : [];
          if (!frames.length) { pmToast('Could not sample video frames.', 'error'); return; }
          // Show the first frame in the bubble; queue every frame for the model.
          _stageMobileRealtimeAgentImage({
            dataUrl: frames[0].dataUrl,
            name: `Video clip (${frames.length} frame${frames.length === 1 ? '' : 's'})`,
            mimeType: frames[0].mimeType || 'image/jpeg',
          }, sid);
          for (let i = 1; i < frames.length; i++) {
            if (!String(frames[i]?.dataUrl || '').trim()) continue;
            const frameImg = {
              dataUrl: frames[i].dataUrl,
              name: frames[i].name || `video-frame-${i + 1}.jpg`,
              mimeType: frames[i].mimeType || 'image/jpeg',
              base64: '',
              realtimeInjected: false,
            };
            __pmRealtimeAgent.pendingImages.push(frameImg);
            // Inject each frame now (audio idle) as sequential visual context.
            _injectRealtimeImageItemToConversation(frameImg, `Video frame ${i + 1} of ${frames.length} from the mobile camera clip — sequential visual context for what I say next.`).catch(() => {});
          }
          // xAI voice: run the whole clip through Grok vision as one summary.
          _kickoffMobileXaiVisionSummary(frames.map((f) => f.dataUrl), { name: 'camera video clip', durationMs: Number(payload?.durationMs || 0) || 0 }).catch(() => {});
        },
      });
    } catch (err) {
      _voiceDebug('realtime-agent-camera-open-failed', { message: err?.message || String(err) });
      pmToast(err?.message || 'Could not open camera.', 'error');
    }
  };
  repeatBtn.addEventListener('click', () => __pmVoice.lastAi && _ttsSpeak(__pmVoice.lastAi));

  clearLink.addEventListener('click', (e) => { e.preventDefault(); __pmVoice.recent = []; _renderRecent(); });

  // ── Speech recognition + streaming pipeline ───────────────────────
  let rec = null;
  let mediaRecorder = null;
  let realtimeTranscription = null;
  let xaiStreamingStt = null;
  let mediaChunks = [];
  let mediaMimeType = '';
  let recognitionTranscript = '';
  let recognitionInterim = '';
  let recognitionSubmitTimer = null;
  let pressArm = false;
  let suppressNextClick = false;
  // Pre-warmed connections — established in background so PTT starts instantly
  let warmRealtimeConn = null;        // { pc, dc, stream, ready } — OpenAI Realtime RTCPeerConnection
  let warmRealtimeConnPromise = null; // in-flight prewarm promise

  function _setStatus(s, hint) { _voiceSetStatus(s, hint); }

  function _voiceListenMode() {
    return __pmVoice.settings?.listenMode === 'always_listening' ? 'always_listening' : 'push_to_speak';
  }

  function _isAlwaysListeningMode() {
    return _voiceListenMode() === 'always_listening';
  }

  function _shouldKeepListening() {
    return pressArm || _isAlwaysListeningMode();
  }

  function _readyVoiceHint() {
    if (!_isAlwaysListeningMode()) return 'Tap and hold the mic to speak';
    const wakePhrase = _cleanMobileWakePhrase(__pmVoice.settings?.wakePhrase || '');
    return wakePhrase && __pmVoice.settings?.wakeGateActive === true
      ? `Quiet until "${wakePhrase}"`
      : 'Always listening while this page stays open';
  }

  function _setReadyVoiceState() {
    _setOrbState(null);
    _setStatus('Ready', _readyVoiceHint());
  }

  function _splitMobileWakePhraseRemainder(text) {
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    const phrase = _isAlwaysListeningMode() && __pmVoice.settings?.wakeGateActive === true
      ? _cleanMobileWakePhrase(__pmVoice.settings?.wakePhrase || '')
      : '';
    if (!source || !phrase) return { allowed: true, text: source };
    const normalizedPhrase = _normalizeMobileWakePhrase(phrase);
    const sourceWords = source.split(/\s+/).filter(Boolean);
    const phraseWords = phrase.split(/\s+/).filter(Boolean);
    if (!normalizedPhrase || !phraseWords.length || sourceWords.length < phraseWords.length) {
      return { allowed: false, text: source };
    }
    for (let i = 0; i <= sourceWords.length - phraseWords.length; i += 1) {
      const candidate = _normalizeMobileWakePhrase(sourceWords.slice(i, i + phraseWords.length).join(' '));
      if (candidate !== normalizedPhrase) continue;
      const remainder = sourceWords.slice(i + phraseWords.length).join(' ').trim();
      _saveVoiceSettings({ wakeGateActive: false });
      _setReadyVoiceState();
      _paintVoiceSettings();
      _paintProviderBanner();
      return { allowed: true, text: remainder, woke: true };
    }
    return { allowed: false, text: source };
  }

  function _collapseDuplicatedFinalTranscript(text) {
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    if (!source) return '';
    const words = source.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length % 2 !== 0) return source;
    const midpoint = words.length / 2;
    const firstWords = words.slice(0, midpoint);
    const secondWords = words.slice(midpoint);
    const firstNormalized = _normalizeMobileWakePhrase(firstWords.join(' '));
    const secondNormalized = _normalizeMobileWakePhrase(secondWords.join(' '));
    if (!firstNormalized || firstNormalized !== secondNormalized) return source;
    const collapsed = firstWords.join(' ').trim();
    _voiceDebug('voice-final-transcript-deduped', { originalLen: source.length, collapsedLen: collapsed.length });
    return collapsed || source;
  }

  function _clearMobileWakePhrase({ speak = false } = {}) {
    _saveVoiceSettings({ wakePhrase: '', wakeGateActive: false });
    _setReadyVoiceState();
    _paintVoiceSettings();
    _paintProviderBanner();
    const text = 'Unlocked. Always listening normally.';
    pmToast('Wake phrase cleared', 'success');
    if (speak) _ttsSpeak(text).catch(() => {});
  }

  function _setMobileWakePhrase(phrase, { speak = false } = {}) {
    const wakePhrase = _cleanMobileWakePhrase(phrase);
    if (!wakePhrase) return false;
    _saveVoiceSettings({ wakePhrase, wakeGateActive: false });
    _setReadyVoiceState();
    _paintVoiceSettings();
    _paintProviderBanner();
    pmToast(`Wake phrase set to "${wakePhrase}"`, 'success');
    _voiceDebug('wake-phrase-set-local', { phraseLen: wakePhrase.length, speak });
    return true;
  }

  function _activateMobileQuietGate({ speak = false } = {}) {
    const wakePhrase = _cleanMobileWakePhrase(__pmVoice.settings?.wakePhrase || '');
    if (!wakePhrase) {
      const text = 'Set a wake phrase first, so you do not get stuck in quiet mode.';
      pmToast('Wake phrase needed', 'Say "set my wake phrase to ..." first.', 'info');
      _setStatus('Wake phrase needed', 'Say “set my wake phrase to ...” first');
      if (speak) _ttsSpeak(text).catch(() => {});
      return true;
    }
    _saveVoiceSettings({ wakeGateActive: true });
    _setStatus('Quiet mode', `Say "${wakePhrase}" to wake Prometheus`);
    _paintVoiceSettings();
    _paintProviderBanner();
    pmToast(`Quiet until "${wakePhrase}"`, 'info');
    return true;
  }

  function _maybeHandleMobileWakeControl(text) {
    if (_isMobileWakeUnlockCommand(text)) {
      _clearMobileWakePhrase({ speak: true });
      return true;
    }
    const wakePhraseCommand = _parseMobileWakePhraseSettingCommand(text);
    if (wakePhraseCommand) {
      _setMobileWakePhrase(wakePhraseCommand.phrase, { speak: false });
      return false;
    }
    if (_isMobileQuietModeCommand(text)) {
      _activateMobileQuietGate({ speak: true });
      return true;
    }
    return false;
  }

  function _submitAlwaysListeningSpeech(text) {
    let finalText = _collapseDuplicatedFinalTranscript(text);
    if (!finalText) return false;
    if (_isMobileWakeUnlockCommand(finalText)) {
      _clearMobileWakePhrase({ speak: true });
      return true;
    }
    const wake = _splitMobileWakePhraseRemainder(finalText);
    if (!wake.allowed) {
      _voiceDebug('wake-phrase-gated', { textLen: finalText.length, phraseLen: String(__pmVoice.settings?.wakePhrase || '').length });
      _setStatus('Listening', `Say "${__pmVoice.settings?.wakePhrase}" to wake Prometheus`);
      return false;
    }
    if (wake.woke && !wake.text) {
      pmToast('Prometheus is listening normally', 'success');
      return true;
    }
    finalText = wake.text || finalText;
    if (_maybeHandleMobileWakeControl(finalText)) return true;
    const submitText = finalText;
    const normalized = _normalizeMobileWakePhrase(submitText);
    const previous = String(__pmVoice.realtimeLastAutoSubmitText || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
    const previousAt = Number(__pmVoice.realtimeLastAutoSubmitAt || 0);
    if (normalized && previous && normalized === previous && Date.now() - previousAt < 10000) {
      _voiceDebug('realtime-always-submit-dedupe', { textLen: submitText.length });
      return false;
    }
    __pmVoice.realtimeLastAutoSubmitText = submitText;
    __pmVoice.realtimeLastAutoSubmitAt = Date.now();
    if (__pmVoice.realtimeAlwaysSubmitTimer) {
      clearTimeout(__pmVoice.realtimeAlwaysSubmitTimer);
      __pmVoice.realtimeAlwaysSubmitTimer = null;
    }
    if (!__pmVoice.alwaysSubmitChain) __pmVoice.alwaysSubmitChain = Promise.resolve();
    __pmVoice.alwaysSubmitChain = __pmVoice.alwaysSubmitChain
      .catch(() => {})
      .then(() => _submitSpeech(submitText))
      .catch((err) => {
        console.warn('[voice] always-listening submit failed', err);
        pmToast(err?.message || 'Voice submit failed', 'error');
      });
    return true;
  }

  function _scheduleRealtimeAlwaysSubmit(reason = 'realtime_settled', delayMs = 900) {
    if (!_isAlwaysListeningMode()) return;
    if (__pmVoice.realtimeAlwaysSubmitTimer) clearTimeout(__pmVoice.realtimeAlwaysSubmitTimer);
    __pmVoice.realtimeAlwaysSubmitTimer = setTimeout(() => {
      __pmVoice.realtimeAlwaysSubmitTimer = null;
      const text = _currentRealtimeTranscript();
      if (!text) return;
      __pmVoice.realtimeTranscript = '';
      __pmVoice.realtimeDeltas = new Map();
      __pmVoice.realtimeFinalAt = 0;
      _voiceDebug('voice-always-submit-fallback', { reason, textLen: text.length });
      _submitAlwaysListeningSpeech(text);
    }, Math.max(120, Number(delayMs || 900) || 900));
  }

  function _voiceCapabilityNote() {
    const secure = window.isSecureContext === true;
    const protocol = String(location.protocol || '');
    const hasMediaDevices = !!navigator.mediaDevices;
    const hasGetUserMedia = !!navigator.mediaDevices?.getUserMedia;
    const hasRecorder = typeof MediaRecorder !== 'undefined';
    const hasRtc = typeof RTCPeerConnection !== 'undefined';
    const flags = `https=${protocol === 'https:'}; secure=${secure}; mic=${hasGetUserMedia}; rtc=${hasRtc}; recorder=${hasRecorder}`;
    if (!secure || protocol !== 'https:') return `Safari blocks microphone access unless the page is opened from trusted HTTPS. ${flags}`;
    if (!hasMediaDevices || !hasGetUserMedia) return `Safari is not exposing microphone capture to this page yet. ${flags}`;
    if (!hasRtc) return `Realtime voice needs WebRTC, which this browser view is not exposing. ${flags}`;
    if (!hasRecorder) return `Server STT needs MediaRecorder, but OpenAI Realtime may still work. ${flags}`;
    return `Mic capture is available. If permission did not appear, check Safari microphone permissions. ${flags}`;
  }

  function _hasUsableWarmMic() {
    const stream = __pmVoice.warmMicStream;
    return !!(stream && stream.getAudioTracks?.().some(track => track.readyState === 'live'));
  }

  async function _ensureWarmMic() {
    if (_hasUsableWarmMic()) return __pmVoice.warmMicStream;
    if (__pmVoice.warmMicPromise) return __pmVoice.warmMicPromise;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(_voiceCapabilityNote());
    __pmVoice.warmMicPromise = navigator.mediaDevices.getUserMedia({
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
      setTimeout(() => _prewarmRealtimeConn(), 80);
      return stream;
    }).catch((err) => {
      __pmVoice.warmMicPromise = null;
      throw err;
    });
    return __pmVoice.warmMicPromise;
  }

  function _releaseWarmMic() {
    try { __pmVoice.warmMicStream?.getTracks?.().forEach(track => track.stop()); } catch {}
    __pmVoice.warmMicStream = null;
    __pmVoice.warmMicPromise = null;
    try { xaiWarmAudioContext?.close?.(); } catch {}
    xaiWarmAudioContext = null;
    _closeRealtimeSpeechConnection();
    _discardWarmRealtimeConn();
  }

  function _discardWarmRealtimeConn() {
    const conn = warmRealtimeConn;
    warmRealtimeConn = null;
    warmRealtimeConnPromise = null;
    // Re-enable tracks before closing so the mic stream isn't left muted
    try { conn?.stream?.getAudioTracks?.().forEach(t => { t.enabled = true; }); } catch {}
    try { conn?.dc?.close?.(); } catch {}
    try { conn?.pc?.close?.(); } catch {}
  }

  // Establishes a RTCPeerConnection + data channel in the background so that
  // when the user presses PTT the connection is already open and transcription
  // begins immediately instead of spending 1–2 s on "Connecting...".
  async function _prewarmRealtimeConn() {
    if (_isMobileRealtimeAgentMode()) return;
    const mode = String(__pmVoice.settings?.voiceMode || 'default');
    const inputProvider = String(__pmVoice.settings?.sttProvider || _inputProviderForMode(mode));
    if (inputProvider !== 'openai_realtime') return;
    if (!_isRealtimeConnected()) return;
    if (realtimeTranscription) return; // never prewarm while a live transcription owns the tracks
    if (warmRealtimeConn?.ready || warmRealtimeConnPromise) return;
    if (!_hasUsableWarmMic()) return; // mic must already be granted — never prompt here
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') return;

    warmRealtimeConnPromise = (async () => {
      try {
        const stream = __pmVoice.warmMicStream; // already live — no getUserMedia call
        // Mute tracks while idle so OpenAI receives no ambient audio
        stream.getAudioTracks().forEach(t => { t.enabled = false; });

        const pc = new RTCPeerConnection();
        stream.getAudioTracks().forEach(track => pc.addTrack(track, stream));
        const dc = pc.createDataChannel('oai-events');

        const dcOpen = new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('Prewarm timeout')), 15000);
          dc.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
          dc.addEventListener('error', () => { clearTimeout(t); reject(new Error('Prewarm DC error')); }, { once: true });
        });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const offerSdp = await _waitForLocalRealtimeOfferSdp(pc);
        const answerSdp = await _exchangeRealtimeSdpViaGateway({
          sdp: offerSdp,
          mode: 'transcription',
          language: navigator.language?.split('-')?.[0] || undefined,
        });
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        await dcOpen;

        // Tracks stay disabled until user presses PTT
        warmRealtimeConn = { pc, dc, stream, ready: true };
        warmRealtimeConnPromise = null;
        _voiceDebug('prewarm-realtime-ok', {});
      } catch (err) {
        warmRealtimeConnPromise = null;
        warmRealtimeConn = null;
        _voiceDebug('prewarm-realtime-error', { message: String(err?.message || err).slice(0, 300) });
      }
    })();
    return warmRealtimeConnPromise;
  }

  window.addEventListener('pagehide', _releaseWarmMic, { once: true });

  function _showDictationFallback(reason) {
    const detail = reason || _voiceCapabilityNote();
    dictFallback.style.display = 'block';
    capNote.textContent = detail;
    _setOrbState(null);
    _setStatus('Use keyboard dictation', detail);
  }

  dictSend.addEventListener('click', async () => {
    const text = String(dictText.value || '').trim();
    if (!text) { pmToast('Dictate or type a command first', 'error'); return; }
    dictText.value = '';
    await _submitSpeech(text);
  });

  function _configuredServerSttProvider() {
    const providers = Array.isArray(__pmVoice.voiceStatus?.sttProviders) ? __pmVoice.voiceStatus.sttProviders : [];
    return providers.find(p => p?.configured && p?.id && p.id !== 'browser')?.id || '';
  }

  function _configuredServerTtsProviders() {
    const providers = Array.isArray(__pmVoice.voiceStatus?.ttsProviders) ? __pmVoice.voiceStatus.ttsProviders : [];
    return providers
      .filter(p => p?.configured && p?.id && !['browser', 'openai_realtime'].includes(p.id))
      .map(p => p.id);
  }

  function _wantsRealtimeDictation(status = __pmVoice.lastVoiceStatus) {
    const mode = String(__pmVoice.settings?.voiceMode || 'default');
    const inputProvider = String(__pmVoice.settings?.sttProvider || _inputProviderForMode(mode));
    return inputProvider === 'openai_realtime' && _isRealtimeConnected(status);
  }

  function _currentRealtimeTranscript() {
    const base = String(__pmVoice.realtimeTranscript || '').trim();
    const deltas = __pmVoice.realtimeDeltas instanceof Map
      ? Array.from(__pmVoice.realtimeDeltas.values()).join(' ').replace(/\s+/g, ' ').trim()
      : '';
    return [base, deltas].filter(Boolean).join(' ').trim();
  }

  function _appendRealtimeTranscript(itemId, text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (itemId && __pmVoice.realtimeDeltas instanceof Map) __pmVoice.realtimeDeltas.delete(itemId);
    __pmVoice.realtimeTranscript = [__pmVoice.realtimeTranscript, clean].filter(Boolean).join(' ').trim();
    __pmVoice.realtimeFinalAt = Date.now();
    _setStatus('Listening...', __pmVoice.realtimeTranscript.slice(0, 90) || 'Release to send');
  }

  function _canUseStreamingPcmStt() {
    return !!(navigator.mediaDevices?.getUserMedia && window.WebSocket && (window.AudioContext || window.webkitAudioContext));
  }

  function _downsampleFloat32(input, inputRate, outputRate) {
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

  function _appendXaiStreamingTranscript(event) {
    const text = String(event?.text || event?.transcript || event?.channel?.text || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (event?.is_final === true || event?.speech_final === true || event?.type === 'transcript.done') {
      __pmVoice.realtimeTranscript = text;
      __pmVoice.realtimeDeltas = new Map();
    } else {
      if (!(__pmVoice.realtimeDeltas instanceof Map)) __pmVoice.realtimeDeltas = new Map();
      __pmVoice.realtimeDeltas.set('xai', text);
      _scheduleRealtimeAlwaysSubmit('xai_partial_idle', 1800);
    }
    _setStatus('Listening...', (_currentRealtimeTranscript() || 'Release to send').slice(0, 90));
  }

  async function _startXaiStreamingListening() {
    const startedAt = Date.now();
    if (!_canUseStreamingPcmStt()) {
      _voiceDebug('xai-stream-stt-unsupported', {
        hasMediaDevices: !!navigator.mediaDevices?.getUserMedia,
        hasWebSocket: !!window.WebSocket,
        hasAudioContext: !!(window.AudioContext || window.webkitAudioContext),
      });
      return _startBackendListening('xai');
    }
    __pmVoice.realtimeTranscript = '';
    __pmVoice.realtimeDeltas = new Map();
    let stream = null;
    try {
      _setOrbState('thinking');
      _setStatus('Connecting...', 'Starting xAI streaming transcription');
      _voiceDebug('xai-stream-stt-start', {});
      stream = await _ensureWarmMic();
      if (!_shouldKeepListening()) {
        _setReadyVoiceState();
        return;
      }
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioCtx({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      const mutedGain = audioContext.createGain();
      mutedGain.gain.value = 0;
      const sampleRate = Math.round(audioContext.sampleRate || 16000);
      const ws = new WebSocket(buildMobileGatewayWsUrl('/api/voice/xai/stt-stream', {
        sample_rate: sampleRate,
        language: navigator.language?.split('-')?.[0] || 'en',
        endpointing: 120,
      }));
      ws.binaryType = 'arraybuffer';
      xaiStreamingStt = { ws, stream, audioContext, source, processor, mutedGain, stopping: false };
      __pmVoice.listening = true;
      mic.classList.add('recording');
      let ready = false;
      let fellBack = false;
      const cleanupStreaming = async () => {
        try { ws.close?.(); } catch {}
        try { processor?.disconnect?.(); } catch {}
        try { source?.disconnect?.(); } catch {}
        try { mutedGain?.disconnect?.(); } catch {}
        if (xaiStreamingStt?.ws === ws) xaiStreamingStt = null;
      };
      const fallbackToBatch = async (reason) => {
        if (fellBack || !_shouldKeepListening()) return;
        fellBack = true;
        _voiceDebug('xai-stream-stt-fallback', { elapsedMs: Date.now() - startedAt, reason: String(reason || '').slice(0, 300) });
        await cleanupStreaming();
        __pmVoice.listening = false;
        mic.classList.remove('recording');
        if (_isAlwaysListeningMode()) {
          _showDictationFallback('Always listening needs a streaming STT provider. xAI streaming did not stay connected.');
          return;
        }
        _setStatus('Listening...', 'Using xAI batch transcription fallback');
        _startBackendListening('xai');
      };
      const readyTimeout = setTimeout(() => {
        if (!ready) fallbackToBatch('xAI streaming STT did not become ready');
      }, 2800);

      ws.addEventListener('open', () => {
        _voiceDebug('xai-stream-stt-ws-open', { elapsedMs: Date.now() - startedAt, sampleRate });
      });
      ws.addEventListener('message', (messageEvent) => {
        let data = null;
        try { data = JSON.parse(messageEvent.data); } catch { return; }
        const type = String(data?.type || '');
        if (type === 'transcript.created') {
          ready = true;
          clearTimeout(readyTimeout);
          dictFallback.style.display = 'none';
          __pmVoice.listening = true;
          _setOrbState('listening');
          _setStatus('xAI listening', 'xAI is streaming microphone audio. Release to send.');
          _voiceDebug('xai-stream-stt-ready', { elapsedMs: Date.now() - startedAt });
          mic.classList.add('recording');
          _prewarmMobileVoiceWorkerContext({ sessionId: __pmVoice.targetSessionId || __pmChat.activeSessionId, source: 'xai_stream_stt_started' });
          return;
        }
        if (type === 'transcript.partial' || type === 'transcript.done') {
          _appendXaiStreamingTranscript(data);
          if (type === 'transcript.done') {
            const text = String(data?.text || data?.transcript || '').replace(/\s+/g, ' ').trim() || _currentRealtimeTranscript();
            if (_isAlwaysListeningMode()) {
              __pmVoice.realtimeTranscript = '';
              __pmVoice.realtimeDeltas = new Map();
              _submitAlwaysListeningSpeech(text);
            } else if (xaiStreamingStt?.ws === ws && xaiStreamingStt?.stopping) {
              _finalizeXaiStreamingSubmit(xaiStreamingStt, text, 'transcript.done');
            }
            _voiceDebug('xai-stream-stt-done', {
              elapsedMs: Date.now() - startedAt,
              textLen: String(data?.text || data?.transcript || '').length,
            });
          }
          return;
        }
        if (type === 'error') {
          const message = data?.error?.message || data?.error || 'xAI streaming transcription failed';
          _voiceDebug('xai-stream-stt-upstream-error', { elapsedMs: Date.now() - startedAt, message: String(message).slice(0, 500) });
          pmToast(String(message), 'error');
          fallbackToBatch(message);
        }
      });
      ws.addEventListener('error', () => {
        _voiceDebug('xai-stream-stt-ws-error', { elapsedMs: Date.now() - startedAt });
        fallbackToBatch('websocket_error');
      });
      ws.addEventListener('close', () => {
        clearTimeout(readyTimeout);
        if (!ready && !fellBack) fallbackToBatch('websocket_closed_before_ready');
      });

      processor.onaudioprocess = (event) => {
        if (!xaiStreamingStt || xaiStreamingStt.stopping || ws.readyState !== WebSocket.OPEN) return;
        const input = event.inputBuffer.getChannelData(0);
        const pcm = _downsampleFloat32(input, audioContext.sampleRate || sampleRate, sampleRate);
        if (pcm.byteLength > 0) {
          try { ws.send(pcm.buffer); } catch {}
        }
      };
      source.connect(processor);
      processor.connect(mutedGain);
      mutedGain.connect(audioContext.destination);
    } catch (err) {
      _voiceDebug('xai-stream-stt-error', { elapsedMs: Date.now() - startedAt, message: String(err?.message || err).slice(0, 500) });
      try { xaiStreamingStt?.ws?.close?.(); } catch {}
      try { xaiStreamingStt?.processor?.disconnect?.(); } catch {}
      try { xaiStreamingStt?.source?.disconnect?.(); } catch {}
      try { xaiStreamingStt?.mutedGain?.disconnect?.(); } catch {}
      xaiStreamingStt = null;
      console.warn('[voice] xAI streaming STT failed, falling back to batch STT', err);
      pmToast('xAI streaming STT failed; using batch transcription', 'error');
      return _startBackendListening('xai');
    }
  }

  function _stopXaiStreamingListening(abort) {
    const conn = xaiStreamingStt;
    if (!conn) return;
    conn.stopping = true;
    try { conn.processor?.disconnect?.(); } catch {}
    try { conn.source?.disconnect?.(); } catch {}
    try { conn.mutedGain?.disconnect?.(); } catch {}
    try { conn.audioContext?.close?.(); } catch {}
    xaiWarmAudioContext = null;
    if (abort) {
      xaiStreamingStt = null;
      try { conn.ws?.close?.(); } catch {}
      __pmVoice.realtimeTranscript = '';
      __pmVoice.realtimeDeltas = new Map();
      _setOrbState(null);
      _setStatus('Ready', 'Tap and hold the mic to speak');
      return;
    }
    _setOrbState('thinking');
    _setStatus('Transcribing...', 'Finalizing xAI transcript');
    try { conn.ws?.send?.(JSON.stringify({ type: 'audio.done' })); } catch {}
    conn.finalizeTimer = setTimeout(() => {
      _finalizeXaiStreamingSubmit(conn, _currentRealtimeTranscript(), 'finalize_timeout');
    }, 2600);
  }

  function _finalizeXaiStreamingSubmit(conn, text, reason = '') {
    if (!conn || conn.finalized) return;
    conn.finalized = true;
    if (conn.finalizeTimer) {
      clearTimeout(conn.finalizeTimer);
      conn.finalizeTimer = null;
    }
    try { conn.ws?.close?.(); } catch {}
    if (xaiStreamingStt === conn) xaiStreamingStt = null;
    const finalText = String(text || '').replace(/\s+/g, ' ').trim();
    __pmVoice.realtimeTranscript = '';
    __pmVoice.realtimeDeltas = new Map();
    _voiceDebug('xai-stream-stt-submit', { reason, textLen: finalText.length });
    if (!finalText) {
      pmToast('I did not catch any speech. Try again.', 'info');
      _setOrbState(null);
      _setStatus('Ready', 'Tap and hold the mic to speak');
      return;
    }
    _submitSpeech(finalText);
  }

  async function _startRealtimeTranscriptionListening() {
    const realtimeStartedAt = Date.now();
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      _voiceDebug('realtime-stt-unsupported', {
        hasMediaDevices: !!navigator.mediaDevices?.getUserMedia,
        hasPeerConnection: typeof RTCPeerConnection !== 'undefined',
      });
      _showDictationFallback(_voiceCapabilityNote());
      pmToast('Safari is not exposing realtime microphone capture to this page', 'error');
      return;
    }
    __pmVoice.realtimeTranscript = '';
    __pmVoice.realtimeDeltas = new Map();
    __pmVoice.realtimeFinalAt = 0;
    let stream = null;
    try {
      _setOrbState('thinking');

      if (!warmRealtimeConn?.ready && warmRealtimeConnPromise) {
        await Promise.race([
          warmRealtimeConnPromise.catch(() => null),
          new Promise(resolve => setTimeout(resolve, 900)),
        ]);
      }
      // ── Fast path: use pre-warmed connection (eliminates 1–2 s "Connecting…") ──
      const prewarmed = warmRealtimeConn?.ready ? warmRealtimeConn : null;
      warmRealtimeConn = null; // consume the pre-warmed slot
      let pc, dc;

      if (prewarmed) {
        stream = prewarmed.stream;
        pc = prewarmed.pc;
        dc = prewarmed.dc;
        // Unmute tracks so OpenAI starts receiving real microphone audio
        stream.getAudioTracks().forEach(t => { t.enabled = true; });
        // Clear any audio that may have accumulated in the buffer during idle
        try { dc.send(JSON.stringify({ type: 'input_audio_buffer.clear' })); } catch {}
        _voiceDebug('realtime-stt-prewarm-hit', { elapsedMs: Date.now() - realtimeStartedAt });
      } else {
        // ── Slow path: establish a fresh connection (first PTT or prewarm missed) ──
        _setStatus('Connecting...', 'Starting OpenAI Realtime transcription');
        _voiceDebug('realtime-stt-start', {
          hasWarmMic: !!__pmVoice.warmMicStream,
          realtimeConnected: _isRealtimeConnected(),
        });
        stream = await _ensureWarmMic();
        if (!_shouldKeepListening()) {
          _setReadyVoiceState();
          return;
        }
        pc = new RTCPeerConnection();
        stream.getAudioTracks().forEach(track => pc.addTrack(track, stream));
        dc = pc.createDataChannel('oai-events');

        const dcOpen = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Realtime transcription channel did not open')), 12000);
          dc.addEventListener('open', () => { clearTimeout(timeout); resolve(true); }, { once: true });
          dc.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Realtime transcription channel failed')); }, { once: true });
        });
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const offerSdp = await _waitForLocalRealtimeOfferSdp(pc);
        _voiceDebug('realtime-stt-offer-ready', {
          sdpLength: offerSdp.length,
          hasAudio: /\r?\nm=audio\s/i.test(offerSdp),
          elapsedMs: Date.now() - realtimeStartedAt,
        });
        const answerSdp = await _exchangeRealtimeSdpViaGateway({
          sdp: offerSdp,
          mode: 'transcription',
          language: navigator.language?.split('-')?.[0] || undefined,
        });
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        await dcOpen;
        if (!_shouldKeepListening()) {
          try { dc.close?.(); } catch {}
          try { pc.close?.(); } catch {}
          _setReadyVoiceState();
          return;
        }
      }

      realtimeTranscription = { pc, dc, stream, stopping: false };

      if (!dc._pmMobileSttHandlerAttached) dc.addEventListener('message', (messageEvent) => {
        let data = null;
        try { data = JSON.parse(messageEvent.data); } catch { return; }
        const type = String(data?.type || '');
        if (type === 'input_audio_buffer.speech_started') {
          if (__pmVoice.realtimeAlwaysSubmitTimer) {
            clearTimeout(__pmVoice.realtimeAlwaysSubmitTimer);
            __pmVoice.realtimeAlwaysSubmitTimer = null;
          }
          __pmVoice.realtimeUtteranceStartedAt = Date.now();
          __pmVoice.realtimeFirstDeltaLogged = false;
          _voiceDebug('mic-speech-started', { provider: 'openai_realtime' });
          _captureVoicePlaybackInterrupt('barge_in');
          _ttsStop();
          _setStatus('Listening...', 'I hear you');
          _prewarmMobileVoiceWorkerContext({ sessionId: __pmVoice.targetSessionId || __pmChat.activeSessionId, source: 'realtime_stt_speech_started' });
          return;
        }
        if (type === 'input_audio_buffer.speech_stopped' || type === 'input_audio_buffer.committed') {
          _voiceDebug('realtime-stt-buffer-event', { provider: 'openai_realtime', type });
          _scheduleRealtimeAlwaysSubmit(type, type === 'input_audio_buffer.committed' ? 750 : 1100);
          return;
        }
        if (type === 'conversation.item.input_audio_transcription.delta') {
          _captureVoicePlaybackInterrupt('barge_in');
          _ttsStop();
          const itemId = String(data?.item_id || 'current');
          const previous = __pmVoice.realtimeDeltas.get(itemId) || '';
          const next = `${previous}${String(data?.delta || '')}`.trim();
          __pmVoice.realtimeDeltas.set(itemId, next);
          if (!__pmVoice.realtimeFirstDeltaLogged) {
            __pmVoice.realtimeFirstDeltaLogged = true;
            _voiceDebug('first-stt-delta', {
              provider: 'openai_realtime',
              itemId,
              elapsedMs: Date.now() - Number(__pmVoice.realtimeUtteranceStartedAt || Date.now()),
              textLen: next.length,
            });
          }
          _setStatus('Listening...', (_currentRealtimeTranscript() || 'Release to send').slice(0, 90));
          _scheduleRealtimeAlwaysSubmit('realtime_delta_idle', 1800);
          return;
        }
        if (type === 'conversation.item.input_audio_transcription.completed') {
          if (__pmVoice.realtimeAlwaysSubmitTimer) {
            clearTimeout(__pmVoice.realtimeAlwaysSubmitTimer);
            __pmVoice.realtimeAlwaysSubmitTimer = null;
          }
          _captureVoicePlaybackInterrupt('barge_in');
          _ttsStop();
          _voiceDebug('stt-final', {
            provider: 'openai_realtime',
            itemId: String(data?.item_id || ''),
            elapsedMs: Date.now() - Number(__pmVoice.realtimeUtteranceStartedAt || Date.now()),
            textLen: String(data?.transcript || '').length,
          });
          _appendRealtimeTranscript(String(data?.item_id || ''), data?.transcript || '');
          if (_isAlwaysListeningMode()) {
            const text = String(data?.transcript || '').replace(/\s+/g, ' ').trim();
            __pmVoice.realtimeTranscript = '';
            __pmVoice.realtimeDeltas = new Map();
            _submitAlwaysListeningSpeech(text);
          }
          return;
        }
        if (type === 'conversation.item.input_audio_transcription.failed' || type === 'error') {
          const message = data?.error?.message || data?.error || 'Realtime transcription failed';
          pmToast(String(message), 'error');
        }
      });
      dc._pmMobileSttHandlerAttached = true;

      dictFallback.style.display = 'none';
      __pmVoice.listening = true;
      _setOrbState('listening');
      _setStatus('Realtime listening', 'OpenAI Realtime is receiving microphone audio. Release to send.');
      _voiceDebug('realtime-stt-ready', { elapsedMs: Date.now() - realtimeStartedAt });
      mic.classList.add('recording');
    } catch (err) {
      if (stream && stream !== __pmVoice.warmMicStream) {
        try { stream.getTracks?.().forEach(track => track.stop()); } catch {}
      }
      try { realtimeTranscription?.dc?.close?.(); } catch {}
      try { realtimeTranscription?.pc?.close?.(); } catch {}
      realtimeTranscription = null;
      _voiceDebug('realtime-stt-error', {
        message: String(err?.message || err).slice(0, 700),
        elapsedMs: Date.now() - realtimeStartedAt,
        wantsRealtime: _wantsRealtimeDictation(),
      });
      if (_wantsRealtimeDictation()) {
        console.warn('[voice] realtime transcription failed, falling back to normal dictation', err);
        pmToast('Realtime STT failed; using normal dictation for input', 'error');
        if (_canUseBrowserRecognition()) return _startBrowserListening();
        const fallback = _configuredServerSttProvider();
        if (fallback) return _startBackendListening(fallback);
        _showDictationFallback(`OpenAI Realtime was selected but could not start: ${err?.message || err}`);
        _setOrbState(null);
        _setStatus('Ready', 'Tap and hold the mic to speak');
        return;
      }
      if (_canUseBrowserRecognition()) return _startBrowserListening();
      pmToast(err.message || 'Realtime transcription failed', 'error');
      _setOrbState(null);
      _setStatus('Ready', 'Tap and hold the mic to speak');
    }
  }

  function _stopRealtimeTranscription(abort) {
    const conn = realtimeTranscription;
    realtimeTranscription = null;
    if (abort) {
      try { conn?.stream?.getAudioTracks?.().forEach(t => { t.enabled = false; }); } catch {}
      try { conn?.dc?.close?.(); } catch {}
      try { conn?.pc?.close?.(); } catch {}
      __pmVoice.realtimeTranscript = '';
      __pmVoice.realtimeDeltas = new Map();
      if (__pmVoice.realtimeAlwaysSubmitTimer) {
        clearTimeout(__pmVoice.realtimeAlwaysSubmitTimer);
        __pmVoice.realtimeAlwaysSubmitTimer = null;
      }
      _setReadyVoiceState();
      // Pre-warm next connection right away so it's ready on the next PTT press
      if (!_isAlwaysListeningMode()) setTimeout(() => _prewarmRealtimeConn(), 400);
      return;
    }
    _setOrbState('thinking');
    _setStatus('Transcribing...', 'Finalizing realtime transcript');
    _prewarmMobileVoiceWorkerContext({ sessionId: __pmVoice.targetSessionId || __pmChat.activeSessionId, source: 'mobile_realtime_transcript_finalizing' });
    try { conn?.dc?.send?.(JSON.stringify({ type: 'input_audio_buffer.commit' })); } catch {}
    const releasedAt = Date.now();
    const submitWhenSettled = () => {
      const text = _currentRealtimeTranscript();
      const finalAgeMs = Date.now() - Number(__pmVoice.realtimeFinalAt || 0);
      if (!text && Date.now() - releasedAt < 650) {
        setTimeout(submitWhenSettled, 80);
        return;
      }
      if (text && (!__pmVoice.realtimeFinalAt || finalAgeMs < 120) && Date.now() - releasedAt < 650) {
        setTimeout(submitWhenSettled, 60);
        return;
      }
      try { conn?.stream?.getAudioTracks?.().forEach(t => { t.enabled = false; }); } catch {}
      try { conn?.dc?.send?.(JSON.stringify({ type: 'input_audio_buffer.clear' })); } catch {}
      if (
        conn?.dc?.readyState === 'open'
        && conn?.pc
        && !['closed', 'failed'].includes(String(conn.pc.connectionState || ''))
        && conn?.stream?.getAudioTracks?.().some(t => t.readyState === 'live')
      ) {
        warmRealtimeConn = { pc: conn.pc, dc: conn.dc, stream: conn.stream, ready: true };
        warmRealtimeConnPromise = null;
        _voiceDebug('realtime-stt-parked-for-reuse', {});
      } else {
        try { conn?.dc?.close?.(); } catch {}
        try { conn?.pc?.close?.(); } catch {}
      }
      __pmVoice.realtimeTranscript = '';
      __pmVoice.realtimeDeltas = new Map();
      __pmVoice.realtimeFinalAt = 0;
      _submitSpeech(text);
      // Pre-warm while the response is being processed
      if (!_isAlwaysListeningMode()) setTimeout(() => _prewarmRealtimeConn(), 400);
    };
    setTimeout(submitWhenSettled, 120);
  }

  // Bridge: the realtime end-to-end agent lives at module scope and cannot reach
  // this closure-local function directly. Expose it so dispatch_prometheus_worker
  // can run real work through the proven voice→worker streaming path.
  __pmRealtimeAgent.submitToWorker = (text, options = {}) => _submitSpeech(text, {
    ...options,
    source: String(options.source || 'realtime_agent_dispatch'),
    skipVoiceAgentHandoff: options.skipVoiceAgentHandoff !== false,
  });

  async function _submitSpeech(text, options = {}) {
    const finalText = String(text || '').trim();
    if (!finalText) { _setStatus('Ready', 'Tap and hold the mic to speak'); _setOrbState(null); return; }
    let activeVoiceRuntime = __pmVoice.activeVoiceRuntime || null;
    const voiceNewChatDraft = _isMobileNewChatDraftActiveForVoice();
    if (voiceNewChatDraft) {
      if (activeVoiceRuntime?.isStreamActive === true) activeVoiceRuntime.isStreamActive = false;
      activeVoiceRuntime = null;
      __pmVoice.activeVoiceRuntime = null;
      __pmChat.activeSessionId = MOBILE_CHAT_SESSION_ID;
      __pmChat.threads[MOBILE_CHAT_SESSION_ID] = Array.isArray(__pmChat.threads[MOBILE_CHAT_SESSION_ID])
        ? __pmChat.threads[MOBILE_CHAT_SESSION_ID]
        : [];
      __pmChat.attachments[MOBILE_CHAT_SESSION_ID] = Array.isArray(__pmChat.attachments[MOBILE_CHAT_SESSION_ID])
        ? __pmChat.attachments[MOBILE_CHAT_SESSION_ID]
        : [];
      __pmVoice.targetSessionId = MOBILE_CHAT_SESSION_ID;
      __pmVoice.targetSessionLabel = 'Mobile - New Chat';
      __pmVoice.targetSessionChannel = 'mobile';
      __pmVoice.targetSessionForced = true;
    }
    const forcedVoiceTarget = __pmVoice.targetSessionForced
      ? String(__pmVoice.targetSessionId || '').trim()
      : '';
    if (
      inlineMode
      && activeVoiceRuntime?.isStreamActive === true
      && forcedVoiceTarget
      && String(activeVoiceRuntime.sessionId || '').trim() !== forcedVoiceTarget
    ) {
      activeVoiceRuntime.isStreamActive = false;
      __pmVoice.activeVoiceRuntime = null;
      activeVoiceRuntime = null;
    }
    _prewarmMobileVoiceWorkerContext({ sessionId: voiceNewChatDraft ? MOBILE_CHAT_SESSION_ID : (__pmVoice.targetSessionId || __pmChat.activeSessionId), source: 'mobile_submit_speech_start', originalUserPrompt: finalText });
    let targetSessionId = voiceNewChatDraft
      ? MOBILE_CHAT_SESSION_ID
      : activeVoiceRuntime?.isStreamActive === true && activeVoiceRuntime?.sessionId
      ? String(activeVoiceRuntime.sessionId).trim()
      : await _resolveVoiceSessionTarget({ forceRefresh: !__pmVoice.targetSessionForced });
    if (targetSessionId === MOBILE_CHAT_SESSION_ID) {
      const actualSessionId = createMobileChatSessionId();
      const voiceTitle = String(finalText || 'New Chat').replace(/\s+/g, ' ').trim().slice(0, 72) || 'New Chat';
      __pmChat.threads[actualSessionId] = Array.isArray(__pmChat.threads[MOBILE_CHAT_SESSION_ID])
        ? __pmChat.threads[MOBILE_CHAT_SESSION_ID]
        : [];
      __pmChat.attachments[actualSessionId] = Array.isArray(__pmChat.attachments[MOBILE_CHAT_SESSION_ID])
        ? __pmChat.attachments[MOBILE_CHAT_SESSION_ID]
        : [];
      __pmChat.threads[MOBILE_CHAT_SESSION_ID] = [];
      __pmChat.attachments[MOBILE_CHAT_SESSION_ID] = [];
      __pmChat.activeSessionId = actualSessionId;
      __pmChat.thread = __pmChat.threads[actualSessionId];
      __pmVoice.targetSessionId = actualSessionId;
      __pmVoice.targetSessionLabel = 'Mobile - Chat';
      __pmVoice.targetSessionChannel = 'mobile';
      __pmVoice.targetSessionForced = true;
      targetSessionId = actualSessionId;
      try {
        await createMobileChatSession(actualSessionId, { title: voiceTitle });
      } catch (err) {
        const msg = String(err?.message || err || '');
        if (!/409|already exists|exists/i.test(msg)) {
          console.warn('[mobile voice] failed to create voice-first mobile session:', err);
        }
      }
      invalidateMobileDrawerSessions('mobile');
      _paintVoiceTarget?.();
      _prewarmMobileVoiceWorkerContext({ sessionId: targetSessionId, source: 'mobile_voice_session_created', originalUserPrompt: finalText, force: true });
      _notifyMobileChatVoiceUpdate(targetSessionId, { reason: 'voice_session_created', force: true });
    }
    const hadPendingInterruption = !!__pmVoice.pendingInterruptContext;
    if (hadPendingInterruption) {
      __pmVoice.pendingInterruptContext = null;
      __pmVoice.lastInterruptionEvent = null;
    }
    if (await _trySubmitVoiceAsLiveSteer(targetSessionId, finalText)) {
      return;
    }
    if (hadPendingInterruption) {
      if (__pmVoice.activeVoiceRuntime?.sessionId === targetSessionId) {
        __pmVoice.activeVoiceRuntime.isStreamActive = false;
      }
      __pmVoice.activeVoiceRuntime = null;
    }
    const interruptionCallerContext = await _finalizeVoiceInterruptionForTranscript(finalText, targetSessionId);
    const interruptionResult = hadPendingInterruption ? __pmVoice.lastInterruptionEvent : null;
    if (interruptionResult?.classification) {
      _applyVoiceInterruptionToMobileChat(targetSessionId, interruptionResult, finalText);
      if (interruptionResult?.steerApplied === true) {
        _setOrbState(null);
        _setStatus('Steer sent', 'Prometheus will fold it into the active run');
        _persistMobileThreadSnapshot(targetSessionId);
        return;
      }
      if (interruptionResult?.action !== 'handoff_new_work') {
        const reply = String(interruptionResult?.voiceReply || '').trim();
        _setOrbState(null);
        _setStatus('Voice handled', reply || 'Interruption handled without starting another worker');
        _persistMobileThreadSnapshot(targetSessionId);
        return;
      }
    }
    if (!hadPendingInterruption && !interruptionResult?.classification && options.skipVoiceAgentHandoff !== true) {
      const voiceAgentHandoff = await _prepareVoiceAgentHandoff(targetSessionId, finalText);
      if (!voiceAgentHandoff.shouldContinueToWorker) {
        _setOrbState(null);
        _renderRecent();
        return;
      }
      if (voiceAgentHandoff.result) __pmVoice.lastHandoffEvent = voiceAgentHandoff.result;
    }
    const realtimeAgentDispatch = String(options.source || '').includes('realtime_agent_dispatch');
    if (!__pmChat.threads[targetSessionId]) __pmChat.threads[targetSessionId] = [];
    const chatThread = __pmChat.threads[targetSessionId];
    if (!interruptionResult?.classification) {
      chatThread.push({
        role: 'user',
        time: _nowTime(),
        body: { text: finalText, source: realtimeAgentDispatch ? 'realtime_agent_dispatch' : 'voice' },
        source: realtimeAgentDispatch ? 'realtime_agent_dispatch' : 'voice',
        channelLabel: realtimeAgentDispatch ? 'Voice Agent handoff' : 'voice',
        voiceAgentWorkerHandoff: realtimeAgentDispatch,
      });
    }
  const chatAiTurn = {
    role: 'ai',
    streaming: true,
    time: '',
    body: { sender: 'Prometheus', text: '' },
    processEntries: [],
    liveTraceEntries: [],
    source: 'voice',
    ...(interruptionResult?.classification ? {
      workflowGroupId: [...chatThread].reverse().find((turn) => turn?.workflowPart === 'interruption')?.workflowGroupId || '',
      workflowPart: ['cancel', 'pause', 'unknown'].includes(String(interruptionResult?.classification?.intent || '')) ? 'abort_response' : 'interruption_response',
      workflowLabel: ['cancel', 'pause', 'unknown'].includes(String(interruptionResult?.classification?.intent || '')) ? 'Abort response' : 'Interruption response',
    } : {}),
  };
    chatThread.push(chatAiTurn);
    _notifyMobileChatVoiceUpdate(targetSessionId, { reason: 'voice_turn_started' });
    const cmd = {
      id: 'cmd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      request: finalText,
      sessionId: targetSessionId,
      sessionLabel: __pmVoice.targetSessionLabel || targetSessionId,
      sessionChannel: __pmVoice.targetSessionChannel || '',
      currentTool: 'thinking…',
      finalText: '',
      toolStream: [],
      generatedImages: [],
      generatedVideos: [],
      status: 'thinking',
      ts: Date.now(),
      expanded: false,
    };
    __pmVoice.recent.unshift(cmd);
    if (__pmVoice.recent.length > 30) __pmVoice.recent.length = 30;
    _renderRecent();
    _setOrbState('thinking');
    _setStatus('Thinking…', 'Prometheus is processing your request');

    // Stream chat over SSE — reuse the same plumbing as the chat page.
    let aiBuf = '';
    let lastSpokenMilestone = '';
    let finalSpoken = false;
    const settleVoiceAfterFinalSpeech = () => {
      const checkSpeak = setInterval(() => {
        if (!__pmVoice.speaking) {
          clearInterval(checkSpeak);
          _setOrbState(null);
          _setStatus('Ready', 'Tap and hold the mic to speak');
        }
      }, 500);
    };
    const handoffResult = __pmVoice.lastHandoffEvent || null;
    __pmVoice.lastHandoffEvent = null;
    const handoffProcessEntries = handoffResult ? _voiceAgentProcessEntriesFromResult(targetSessionId, handoffResult) : [];
    if (handoffProcessEntries.length) {
      chatAiTurn.processEntries.push(...handoffProcessEntries);
    }
    if (realtimeAgentDispatch) {
      _appendMobileProcess(chatAiTurn, 'info', `Voice Agent handoff to Worker: ${finalText.slice(0, 900)}`, {
        actor: 'Voice Agent',
        stage: 'mobile_voice_worker_user_message',
        sessionId: targetSessionId,
        source: 'realtime_agent_dispatch',
        requestId: cmd.id,
      });
    } else {
      _appendMobileUserProcess(chatAiTurn, finalText, {
        stage: 'mobile_voice_worker_user_message',
        sessionId: targetSessionId,
        source: 'voice_worker_handoff',
        requestId: cmd.id,
      });
    }
    const handoffAck = String(handoffResult?.voiceReply || '').trim();
    const backendHandoffContext = String(handoffResult?.injectedContextText || '').trim();
    const realtimeAgentDispatchContext = realtimeAgentDispatch
      ? [
        '[REALTIME_AGENT_HANDOFF]',
        'This mobile realtime voice turn was already acknowledged by the live realtime voice agent before the worker started.',
        'Do not repeat a generic startup acknowledgement. Continue directly into the requested work.',
        '[/REALTIME_AGENT_HANDOFF]',
      ].join('\n')
      : '';
    const handoffContext = backendHandoffContext || (handoffResult
      ? [
        '[VOICE_AGENT_HANDOFF]',
        'This mobile voice turn was already acknowledged out loud by the Prometheus Voice Agent before the worker started.',
        handoffAck ? `Spoken acknowledgement: ${handoffAck}` : '',
        `Voice action: ${handoffResult.action || 'handoff_new_work'}`,
        handoffResult.workerInstruction ? `Worker instruction: ${handoffResult.workerInstruction}` : '',
        handoffResult.contextPacket?.id ? `Voice context packet: ${handoffResult.contextPacket.id}` : '',
        'Do not repeat a generic startup acknowledgement. Continue directly into the work.',
        '[/VOICE_AGENT_HANDOFF]',
      ].filter(Boolean).join('\n')
      : '');
    const callerContext = [interruptionCallerContext || _consumeVoicePlaybackInterruptContext(targetSessionId), handoffContext, realtimeAgentDispatchContext]
      .filter(Boolean)
      .join('\n\n');
    const voiceWorkerHandoffStartedAt = Date.now();
    let voiceWorkerFirstPreflightLogged = false;
    let voiceWorkerFirstTokenLogged = false;
    _voiceDebug('worker-handoff-starting', { sessionId: targetSessionId, requestId: cmd.id });
    const interruptionIntent = String(interruptionResult?.classification?.intent || '').trim();
    if (interruptionCallerContext && (interruptionIntent === 'cancel' || interruptionIntent === 'pause' || interruptionIntent === 'unknown')) {
      const reply = String(interruptionResult?.voiceReply || '').trim();
      cmd.status = interruptionIntent === 'cancel' ? 'cancelled' : interruptionIntent;
      cmd.currentTool = interruptionIntent;
      cmd.finalText = reply;
      if (reply) {
        chatAiTurn.streaming = false;
        chatAiTurn.time = _nowTime();
        chatAiTurn.body.text = reply;
        chatAiTurn.content = reply;
      } else {
        const idx = chatThread.indexOf(chatAiTurn);
        if (idx >= 0) chatThread.splice(idx, 1);
      }
      _appendMobileProcess(chatAiTurn, 'info', `Voice interruption: ${interruptionIntent}`);
      if (reply) __pmVoice.lastAi = reply;
      _refreshRepeatBtn();
      _renderRecent();
      _persistMobileThreadSnapshot(targetSessionId);
      _setOrbState(null);
      _setStatus(interruptionIntent === 'cancel' ? 'Cancelled' : interruptionIntent === 'pause' ? 'Paused' : 'Ready', reply);
      return;
    }
    __pmVoice.spokenTextSoFar = '';
    __pmVoice.currentSpokenSegment = '';
    __pmVoice.lastVoiceMilestone = '';
    __pmVoice.activeVoiceRuntime = {
      sessionId: targetSessionId,
      activeRequestId: cmd.id,
      originalPrompt: finalText,
      assistantTextSoFar: '',
      startedAt: Date.now(),
      isStreamActive: true,
    };
    if (__pmRealtimeAgent.quiet.active) _sendMobileRealtimeAgentCreateResponseFlag(false);
    _startMobileRealtimeAgentContextRefreshLoop(__pmRealtimeAgent.conn);
    const stopVoiceAgentNarration = realtimeAgentDispatch
      ? _startVoiceAgentNarrationLoop(targetSessionId, cmd.id, { realtimeAgent: true })
      : _startVoiceAgentNarrationLoop(targetSessionId, cmd.id);

    // Subscribe to WebSocket approval events while this stream is active.
    const _wsApprovalHandler = async (msg) => {
      if (msg.sessionId && msg.sessionId !== targetSessionId) return;
      try {
        const list = await loadMobileApprovals('pending');
        const approval = list.find(a => a.id === (msg.approvalId || msg.id))
          || list.find(a => a.sessionId === targetSessionId)
          || list[0];
        if (approval) _showVoiceApproval(approval);
      } catch {}
    };
    window.wsEventBus?.on('approval_created', _wsApprovalHandler);

    let voiceAbortHandle = null;
    const clearVoiceActiveRun = () => {
      _stopMobileRealtimeAgentContextRefreshLoop();
      if (__pmChat.activeRuns?.[targetSessionId]?.abort === voiceAbortHandle) {
        delete __pmChat.activeRuns[targetSessionId];
      }
      __pmChat.busy = Object.values(__pmChat.activeRuns || {}).some((run) => run?.busy);
      _clearMobileActiveRun(targetSessionId);
      _markMobileSessionRunning(targetSessionId, false);
    };
    const stream = streamChat({ message: finalText, sessionId: targetSessionId, callerContext }, {
      onInfo: (m) => {
        cmd.status = 'streaming';
        _updateToolFlip(cmd, String(m).slice(0, 80));
        cmd.toolStream.push(String(m));
        _appendMobileProcess(chatAiTurn, 'info', String(m));
        _notifyMobileChatVoiceUpdate(targetSessionId, { reason: 'voice_info' });
        if (!voiceWorkerFirstPreflightLogged) {
          voiceWorkerFirstPreflightLogged = true;
          _voiceDebug('worker-first-preflight', {
            sessionId: targetSessionId,
            requestId: cmd.id,
            elapsedMs: Date.now() - voiceWorkerHandoffStartedAt,
            message: String(m).slice(0, 180),
          });
        }
        if (cmd.expanded) _renderRecent();
        // Speak the milestone if in milestone mode and it looks like a step.
        const spokenMilestone = _voiceSpokenMilestone(m);
        if (!realtimeAgentDispatch && __pmVoice.dictation === 'milestone' && spokenMilestone && spokenMilestone !== lastSpokenMilestone) {
          lastSpokenMilestone = spokenMilestone;
          // Speak softly — but only if not already speaking
          _speakVoiceMilestone(spokenMilestone, { minGapMs: 3200 });
        }
      },
      onToken: (chunk) => {
        aiBuf += chunk;
        if (!voiceWorkerFirstTokenLogged && chunk) {
          voiceWorkerFirstTokenLogged = true;
          _voiceDebug('worker-first-token', {
            sessionId: targetSessionId,
            requestId: cmd.id,
            elapsedMs: Date.now() - voiceWorkerHandoffStartedAt,
            textLen: String(chunk).length,
          });
        }
        if (__pmVoice.activeVoiceRuntime?.activeRequestId === cmd.id) {
          __pmVoice.activeVoiceRuntime.assistantTextSoFar = aiBuf;
        }
        chatAiTurn.body.text = aiBuf;
        chatAiTurn.content = aiBuf;
        _notifyMobileChatVoiceUpdate(targetSessionId, { reason: 'voice_token' });
        cmd.status = 'streaming';
        _updateToolFlip(cmd, 'responding...');
      },
      onVoiceMilestone: (evt) => {
        const text = String(evt?.text || '').trim();
        if (!text) return;
        if (__pmVoice.dictation === 'milestone') {
          cmd.toolStream.push(`voice: ${text}`);
          _appendMobileProcess(chatAiTurn, 'info', `Voice milestone: ${text}`, evt);
          _notifyMobileChatVoiceUpdate(targetSessionId, { reason: 'voice_milestone' });
          if (cmd.expanded) _renderRecent();
        }
        const spokenMilestone = _voiceSpokenMilestone(text);
        if (!realtimeAgentDispatch && __pmVoice.dictation === 'milestone' && spokenMilestone) {
          _speakVoiceMilestone(spokenMilestone, { minGapMs: Number(evt?.minGapMs ?? 2500) || 2500 });
        }
      },
      onThinking: (m) => {
        _appendMobileProcess(chatAiTurn, 'think', String(m).slice(0, 220));
        _appendMobileLiveTrace(chatAiTurn, 'think', m, { append: true });
        _notifyMobileChatVoiceUpdate(targetSessionId, { reason: 'voice_thinking' });
      },
      onToolCall: (evt) => {
        const label = _mobileToolLabel(evt);
        const args = _safeJsonPreview(evt.args || evt.params || evt.input);
        const text = `${label}${args ? `: ${args}` : ''}`;
        _appendMobileProcess(chatAiTurn, 'tool', text, evt);
        _appendMobileLiveTrace(chatAiTurn, 'tool', text);
        _notifyMobileChatVoiceUpdate(targetSessionId, { reason: 'voice_tool_call' });
        _updateToolFlip(cmd, label.slice(0, 80));
        cmd.toolStream.push(`⚙ ${text}`);
        if (cmd.expanded) _renderRecent();
      },
      onToolResult: (evt) => {
        const label = _mobileToolLabel(evt);
        const result = _safeJsonPreview(evt.result || evt.output || evt.error || '', 180);
        const beforeMedia = _collectMessageMedia(chatAiTurn);
        _collectMediaFromToolEvent(chatAiTurn, evt);
        _collectMediaFromToolEvent(cmd, evt);
        const newMedia = _diffMobileMedia(beforeMedia, _collectMessageMedia(chatAiTurn));
        if (newMedia.length) _enqueueVoicePreviews(newMedia, { transient: false });
        const resultText = `${label}${result ? ` → ${result}` : ' complete'}`;
        _appendMobileProcess(chatAiTurn, evt.error ? 'error' : 'result', `${label}${result ? ` -> ${result}` : ' complete'}`, evt);
        _appendMobileLiveTrace(chatAiTurn, evt.error ? 'error' : 'result', `${label}${evt.error ? ' failed' : ' complete'}`);
        _notifyMobileChatVoiceUpdate(targetSessionId, { reason: 'voice_tool_result' });
        cmd.toolStream.push(`${evt.error ? '✗' : '✓'} ${resultText}`);
        if (cmd.expanded) _renderRecent();
      },
      onToolProgress: (evt) => {
        const progressText = `${_mobileToolLabel(evt)}: ${String(evt.message || '').trim()}`;
        _appendMobileProcess(chatAiTurn, 'info', progressText, evt);
        _appendMobileLiveTrace(chatAiTurn, 'tool', progressText);
        _notifyMobileChatVoiceUpdate(targetSessionId, { reason: 'voice_tool_progress' });
        cmd.toolStream.push(`… ${progressText}`);
        if (cmd.expanded) _renderRecent();
      },
      onCanvasPresent: (evt) => {
        const path = String(evt.path || '').trim();
        if (!path) return;
        const name = evt.name || path.split(/[\\/]/).pop();
        const kind = _mobileMediaKind({ path, name });
        const item = { path, name, kind };
        _mergeMobileMediaIntoMessage(chatAiTurn, [item]);
        _mergeMobileMediaIntoMessage(cmd, [item]);
        _enqueueVoicePreviews([item], { transient: false });
        _appendMobileProcess(chatAiTurn, 'file', `Presented file: ${path}`, evt);
        _notifyMobileChatVoiceUpdate(targetSessionId, { reason: 'voice_canvas_present' });
        if (cmd.expanded) _renderRecent();
      },
      onEvent: (evt) => {
        if (String(evt?.type || '') !== 'vision_injected') return;
        const media = _visionEventToMobileMedia(evt);
        if (media) _enqueueVoicePreviews([media], { transient: true });
      },
      onModelEvent: (evt) => {
        if (String(evt?.type || '') === 'model_stream_event') {
          const modelEvent = evt.event && typeof evt.event === 'object' ? evt.event : {};
          const eventType = String(modelEvent.type || '').trim();
          if (eventType === 'tool_call_start' || eventType === 'tool_call_done') {
            const name = String(modelEvent.name || 'tool').replace(/_/g, ' ');
            _appendMobileLiveTrace(chatAiTurn, 'tool', eventType === 'tool_call_start' ? `Preparing ${name}...` : `Prepared ${name}`);
          }
          return;
        }
        const model = evt.model || evt.modelRef || evt.providerId || 'model';
        _appendMobileProcess(chatAiTurn, 'info', `Model: ${model}`, evt);
      },
      onFinal: (text, evt = {}) => {
        aiBuf = text || aiBuf;
        const beforeMedia = _collectMessageMedia(chatAiTurn);
        _collectMediaFromToolEvent(chatAiTurn, evt);
        _collectMediaFromToolEvent(cmd, evt);
        const newMedia = _diffMobileMedia(beforeMedia, _collectMessageMedia(chatAiTurn));
        if (newMedia.length) _enqueueVoicePreviews(newMedia, { transient: false });
        if (!aiBuf || finalSpoken) return;
        stopVoiceAgentNarration();
        clearVoiceActiveRun();
        if (__pmVoice.activeVoiceRuntime?.activeRequestId === cmd.id) {
          __pmVoice.activeVoiceRuntime.assistantTextSoFar = aiBuf;
          __pmVoice.activeVoiceRuntime.isStreamActive = false;
        }
        chatAiTurn.streaming = false;
        chatAiTurn.time = _nowTime();
        chatAiTurn.body.text = aiBuf;
        chatAiTurn.content = aiBuf;
        _notifyMobileChatVoiceUpdate(targetSessionId, { reason: 'voice_final' });
        _persistMobileThreadSnapshot(targetSessionId);
        __pmVoice.pendingInterruptContext = null;
        _ttsStop();
        finalSpoken = true;
        const spokeWithRealtimeAgent = realtimeAgentDispatch && _requestMobileRealtimeAgentFinalSummary(aiBuf);
        if (!spokeWithRealtimeAgent) _ttsSpeak(aiBuf);
        _setOrbState('speaking');
        _setStatus('Speaking response', realtimeAgentDispatch ? 'Realtime agent is summarizing the result' : 'Tap mic again to follow up');
        settleVoiceAfterFinalSpeech();
      },
      onError: (err) => {
        stopVoiceAgentNarration();
        clearVoiceActiveRun();
        if (__pmVoice.activeVoiceRuntime?.activeRequestId === cmd.id) __pmVoice.activeVoiceRuntime.isStreamActive = false;
        window.wsEventBus?.off('approval_created', _wsApprovalHandler);
        if (!_activeVoiceCommandApprovalId) _hideVoiceApproval();
        cmd.status = 'error';
        cmd.currentTool = 'error';
        cmd.finalText = '⚠️ ' + (err.message || 'Chat error');
        chatAiTurn.body.text = (chatAiTurn.body.text ? chatAiTurn.body.text + '\n\n' : '') + `Error: ${err.message || 'Chat error'}`;
        chatAiTurn.streaming = false;
        chatAiTurn.time = _nowTime();
        _appendMobileProcess(chatAiTurn, 'error', err.message || 'Chat error');
        _persistMobileThreadSnapshot(targetSessionId);
        _notifyMobileChatVoiceUpdate(targetSessionId, { reason: 'voice_error', force: true });
        pmToast(err.message || 'Voice request failed', 'error');
        _renderRecent();
        _setOrbState(null);
        _setStatus('Error', 'Try again or tap repeat last response');
      },
      onDone: () => {
        stopVoiceAgentNarration();
        clearVoiceActiveRun();
        if (__pmVoice.activeVoiceRuntime?.activeRequestId === cmd.id) {
          __pmVoice.activeVoiceRuntime.assistantTextSoFar = aiBuf;
          __pmVoice.activeVoiceRuntime.isStreamActive = false;
        }
        __pmVoice.pendingInterruptContext = null;
        window.wsEventBus?.off('approval_created', _wsApprovalHandler);
        _hideVoiceApproval();
        cmd.status = 'done';
        cmd.currentTool = 'complete';
        cmd.finalText = aiBuf;
        chatAiTurn.streaming = false;
        chatAiTurn.time = _nowTime();
        if (aiBuf) chatAiTurn.body.text = aiBuf;
        chatAiTurn.content = String(chatAiTurn.body?.text || '');
        _persistMobileThreadSnapshot(targetSessionId);
        _notifyMobileChatVoiceUpdate(targetSessionId, { reason: 'voice_done', force: true });
        __pmVoice.lastAi = aiBuf;
        _refreshRepeatBtn();
        _renderRecent();
        if (!finalSpoken) {
          _ttsStop();                   // stop any milestone narration
          if (aiBuf) {
            finalSpoken = true;
            const spokeWithRealtimeAgent = realtimeAgentDispatch && _requestMobileRealtimeAgentFinalSummary(aiBuf);
            if (!spokeWithRealtimeAgent) _ttsSpeak(aiBuf);
          }
          _setOrbState('speaking');
          _setStatus('Speaking response', realtimeAgentDispatch ? 'Realtime agent is summarizing the result' : 'Tap mic again to follow up');
          settleVoiceAfterFinalSpeech();
        }
      },
    });
    voiceAbortHandle = { abort: () => {
      _appendMobileProcess(chatAiTurn, 'warn', 'Stop requested. Asking the gateway to abort the live runtime.');
      stopVoiceAgentNarration();
      clearVoiceActiveRun();
      stopMobileMainChat(targetSessionId).catch((err) => {
        _appendMobileProcess(chatAiTurn, 'error', `Backend abort request failed: ${err?.message || err}`);
      });
      stream.abort();
    } };
    if (!__pmChat.activeRuns || typeof __pmChat.activeRuns !== 'object') __pmChat.activeRuns = {};
    __pmChat.activeRuns[targetSessionId] = {
      ...(__pmChat.activeRuns[targetSessionId] || {}),
      busy: true,
      abort: voiceAbortHandle,
      source: 'voice',
    };
    __pmChat.busy = true;
    _rememberMobileActiveRun(targetSessionId);
    _markMobileSessionRunning(targetSessionId, true);
    _notifyMobileChatVoiceUpdate(targetSessionId, { reason: 'voice_run_active' });
    cmd._stream = stream;
  }

  async function _startListening() {
    if (__pmVoice.listening) return;
    _captureVoicePlaybackInterrupt('barge_in');
    _ttsStop();
    recognitionTranscript = '';
    recognitionInterim = '';
    if (recognitionSubmitTimer) {
      clearTimeout(recognitionSubmitTimer);
      recognitionSubmitTimer = null;
    }
    // Full Realtime voice agent path — OpenAI Realtime handles STT + reasoning
    // + TTS in a single session. No transcript posting, no gateway voice agent
    // decision call. Bypasses the entire split flow when active.
    if (_isMobileRealtimeAgentMode()) {
      const sid = __pmVoice.targetSessionId || __pmChat.activeSessionId || 'mobile_default';
      const listenMode = _isAlwaysListeningMode() ? 'always_listening' : 'push_to_talk';
      const wakePhrase = _cleanMobileWakePhrase(__pmVoice?.settings?.wakePhrase || '');
      const quietActive = listenMode === 'always_listening' && __pmVoice?.settings?.wakeGateActive === true && !!wakePhrase;
      __pmVoice.listening = true;
      _setOrbState('listening');
      _setStatus(
        quietActive ? 'Quiet mode' : 'Listening...',
        quietActive ? `Say "${wakePhrase}" to wake Prometheus` : (listenMode === 'always_listening' ? 'Always listening with Realtime agent.' : 'Release to send')
      );
      mic.classList.add('recording');
      try {
        if (listenMode === 'always_listening') {
          await _mobileRealtimeAgentEnableAlwaysListening(sid);
        } else {
          _mobileRealtimeAgentPttPress(sid);
        }
      } catch (err) {
        _voiceDebug('realtime-agent-start-failed', { message: err?.message || String(err) });
        pmToast(`Realtime agent failed: ${err?.message || err}`, 'error');
        __pmVoice.listening = false;
        mic.classList.remove('recording');
        _setReadyVoiceState();
      }
      return;
    }
    const mode = String(__pmVoice.settings?.voiceMode || 'default');
    const inputProvider = String(__pmVoice.settings?.sttProvider || _inputProviderForMode(mode));
    if (inputProvider === 'openai_realtime') {
      if (!_isRealtimeConnected()) {
        pmToast('OpenAI Realtime is not connected; using Default', 'error');
        __pmVoice.provider = { ...(__pmVoice.provider || {}), sttProvider: 'browser', canRealtime: false };
        _startBrowserListening();
        return;
      }
      const detected = __pmVoice.lastVoiceStatus ? _detectProvider(__pmVoice.lastVoiceStatus) : (__pmVoice.provider || {});
      __pmVoice.provider = {
        ...detected,
        canRealtime: true,
        sttProvider: 'openai_realtime',
        ttsProvider: detected.ttsProvider || __pmVoice.settings?.ttsProvider || 'browser',
        voice: __pmVoice.settings?.realtimeVoice || __pmVoice.provider?.voice || 'marin',
        speed: Number((detected.ttsProvider || __pmVoice.settings?.ttsProvider) === 'xai' ? (__pmVoice.settings?.xaiSpeed || 1.0) : (__pmVoice.settings?.realtimeSpeed || 1.05)),
      };
      _setStatus('Connecting...', 'Starting OpenAI Realtime input');
      _startRealtimeTranscriptionListening();
      return;
    }
    if (inputProvider === 'xai') {
      const sttProviders = Array.isArray(__pmVoice.voiceStatus?.sttProviders) ? __pmVoice.voiceStatus.sttProviders : [];
      const xaiSttReady = sttProviders.some(p => p?.configured && p?.id === 'xai');
      const detected = __pmVoice.lastVoiceStatus ? _detectProvider(__pmVoice.lastVoiceStatus) : (__pmVoice.provider || {});
      __pmVoice.provider = {
        ...detected,
        sttProvider: 'xai',
        ttsProvider: detected.ttsProvider || __pmVoice.settings?.ttsProvider || 'browser',
        ttsVoice: __pmVoice.settings?.serverVoice || __pmVoice.provider?.ttsVoice || 'eve',
        speed: Number((detected.ttsProvider || __pmVoice.settings?.ttsProvider) === 'xai' ? (__pmVoice.settings?.xaiSpeed || 1.0) : (__pmVoice.settings?.realtimeSpeed || 1.05)),
      };
      if (!xaiSttReady) {
        pmToast('xAI/Grok transcription is not connected; using Default input', 'error');
        __pmVoice.provider = { ...__pmVoice.provider, sttProvider: 'browser', canRealtime: false };
        _startBrowserListening();
        return;
      }
      _startXaiStreamingListening();
      return;
    }
    __pmVoice.provider = {
      ...(__pmVoice.provider || {}),
      sttProvider: 'browser',
      ttsProvider: __pmVoice.settings?.ttsProvider || __pmVoice.provider?.ttsProvider || 'browser',
      canRealtime: false,
    };
    _startBrowserListening();
    loadVoiceStatus().then(status => {
      __pmVoice.lastVoiceStatus = status;
      __pmVoice.voiceStatus = status?.voice || null;
      const detected = _detectProvider(status);
      __pmVoice.provider = { ...detected, sttProvider: 'browser' };
      _paintVoiceSettings();
    }).catch(() => {});
  }

  function _startBrowserListening() {
    _captureVoicePlaybackInterrupt('barge_in');
    _ttsStop();
    rec = _makeRecognizer();
    if (!rec) {
      _showDictationFallback('Browser dictation is not available here. Choose a server STT provider or OpenAI Realtime in Voice Settings.');
      pmToast('Voice recognition unavailable in this browser', 'error');
      _setReadyVoiceState();
      return;
    }
    if (!_shouldKeepListening()) {
      _setReadyVoiceState();
      return;
    }
    rec.continuous = _isAlwaysListeningMode();
    __pmVoice.listening = true;
    _setOrbState('listening');
    _setStatus('Listening...', _isAlwaysListeningMode() ? 'Always listening. Tap the mic to pause.' : 'Release to send');
    mic.classList.add('recording');

    rec.onresult = (evt) => {
      let interim = '', fin = '';
      for (let i = evt.resultIndex; i < evt.results.length; i++) {
        const t = evt.results[i][0].transcript;
        if (String(t || '').trim()) {
          _captureVoicePlaybackInterrupt('barge_in');
          _ttsStop();
        }
        if (evt.results[i].isFinal) fin += t; else interim += t;
      }
      if (fin) recognitionTranscript = (recognitionTranscript + ' ' + fin).trim();
      recognitionInterim = String(interim || '').trim();
      const transcript = _latestBrowserTranscript();
      _setStatus('Listening...', (transcript || '...').slice(0, 80));
      if (_isAlwaysListeningMode() && fin) {
        recognitionTranscript = '';
        recognitionInterim = '';
        _submitAlwaysListeningSpeech(fin);
      }
    };
    rec.onerror = (e) => {
      console.warn('[voice] recognition error', e);
      pmToast(`Mic error: ${e.error || 'unknown'}`, 'error');
      _stopListening(true);
    };
    rec.onend = () => {
      if (__pmVoice.listening && _isAlwaysListeningMode()) {
        rec = null;
        setTimeout(() => {
          if (__pmVoice.listening && _isAlwaysListeningMode()) _startBrowserListening();
        }, 250);
        return;
      }
      if (__pmVoice.listening) _stopListening(false);
    };
    _prewarmMobileVoiceWorkerContext({ sessionId: __pmVoice.targetSessionId || __pmChat.activeSessionId, source: 'browser_stt_started' });
    try { rec.start(); } catch (err) {
      pmToast('Could not start mic. Check permissions.', 'error');
      _stopListening(true);
    }
  }

  function _latestBrowserTranscript() {
    return String(recognitionTranscript || recognitionInterim || '').replace(/\s+/g, ' ').trim();
  }

  function _submitBrowserTranscriptSoon(delayMs = 180) {
    if (recognitionSubmitTimer) clearTimeout(recognitionSubmitTimer);
    recognitionSubmitTimer = setTimeout(() => {
      recognitionSubmitTimer = null;
      const text = _latestBrowserTranscript();
      recognitionTranscript = '';
      recognitionInterim = '';
      rec = null;
      _submitSpeech(text);
    }, delayMs);
  }

  async function _startBackendListening(provider) {
    if (_isAlwaysListeningMode()) {
      _showDictationFallback('Always listening needs browser dictation, OpenAI Realtime, or xAI streaming STT. Server batch transcription remains Push to Speak.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      _showDictationFallback(_voiceCapabilityNote());
      pmToast('Safari is not exposing microphone capture to this page', 'error');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      _showDictationFallback(_voiceCapabilityNote());
      pmToast('Safari is not exposing MediaRecorder for server STT', 'error');
      return;
    }
    try {
      const stream = await _ensureWarmMic();
      if (!_shouldKeepListening()) {
        _setReadyVoiceState();
        return;
      }
      dictFallback.style.display = 'none';
      mediaChunks = [];
      mediaMimeType = _getRecorderMimeType(provider);
      mediaRecorder = new MediaRecorder(stream, mediaMimeType ? { mimeType: mediaMimeType } : undefined);
      const recordingStartedAt = Date.now();
      __pmVoice.listening = true;
      _captureVoicePlaybackInterrupt('barge_in');
      _ttsStop();
      _setOrbState('listening');
      _setStatus('Listening…', `Release to transcribe with ${provider}`);
      mic.classList.add('recording');
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) mediaChunks.push(event.data);
      };
      mediaRecorder.onerror = (event) => {
        console.warn('[voice] recorder error', event);
        pmToast('Recording failed', 'error');
        _stopListening(true);
      };
      mediaRecorder.onstop = async () => {
        const chunks = mediaChunks.slice();
        mediaChunks = [];
        const recorder = mediaRecorder;
        mediaRecorder = null;
        if (!chunks.length) {
          _setOrbState(null);
          _setStatus('Ready', 'Tap and hold the mic to speak');
          return;
        }
        try {
          const stopToTranscribeStartedAt = Date.now();
          _setOrbState('thinking');
          _setStatus('Transcribing…', `Sending audio to ${provider}`);
          const blob = new Blob(chunks, { type: mediaMimeType || 'audio/webm' });
          _voiceDebug('stt-recording-finalized', {
            provider,
            mimeType: blob.type || mediaMimeType || 'audio/webm',
            bytes: blob.size || 0,
            recordMs: stopToTranscribeStartedAt - recordingStartedAt,
          });
          const audioBase64 = await _blobToBase64(blob);
          const uploadStartedAt = Date.now();
          const data = await transcribeVoiceAudio({
            provider,
            audioBase64,
            mimeType: blob.type || mediaMimeType || 'audio/webm',
            filename: `prometheus-mobile-${Date.now()}.${_audioExtensionForMimeType(blob.type || mediaMimeType)}`,
            language: navigator.language?.split('-')?.[0] || undefined,
          });
          _voiceDebug('stt-result', {
            provider,
            textLen: String(data?.text || '').length,
            uploadAndTranscribeMs: Date.now() - uploadStartedAt,
          });
          await _submitSpeech(data?.text || '');
        } catch (err) {
          pmToast(err.message || 'Transcription failed', 'error');
          _setOrbState(null);
          _setStatus('Ready', 'Tap and hold the mic to speak');
        }
      };
      mediaRecorder.start(250);
    } catch (err) {
      pmToast(err.message || 'Could not start mic. Check permissions.', 'error');
      _setOrbState(null);
      _setStatus('Ready', 'Tap and hold the mic to speak');
    }
  }

  function _stopListening(abort) {
    if (!__pmVoice.listening) return;
    __pmVoice.listening = false;
    mic.classList.remove('recording');
    // Realtime agent path — PTT release commits buffer + asks for response;
    // always-listening abort tears down the session.
    if (__pmRealtimeAgent?.conn) {
      if (__pmRealtimeAgent.listenMode === 'always_listening' || abort) {
        _mobileRealtimeAgentDisableAlwaysListening();
        _setOrbState(null);
        _setStatus('Ready', 'Tap and hold the mic to speak');
      } else {
        _mobileRealtimeAgentPttRelease();
        _setOrbState('thinking');
        _setStatus('Thinking...', 'Realtime agent is responding');
      }
      return;
    }
    if (xaiStreamingStt) {
      _stopXaiStreamingListening(abort);
      return;
    }
    if (mediaRecorder) {
      const recorder = mediaRecorder;
      if (abort) {
        mediaChunks = [];
        mediaRecorder = null;
      }
      try { recorder.stop(); } catch {}
      if (abort) {
        _setOrbState(null);
        _setStatus('Ready', 'Tap and hold the mic to speak');
      }
      return;
    }
    if (realtimeTranscription) {
      _stopRealtimeTranscription(abort);
      return;
    }
    const activeRec = rec;
    if (abort) {
      try { activeRec?.abort?.(); } catch { try { activeRec?.stop?.(); } catch {} }
      rec = null;
      recognitionTranscript = '';
      recognitionInterim = '';
      _setOrbState(null);
      _setStatus('Ready', 'Tap and hold the mic to speak');
      return;
    }
    if (activeRec) {
      activeRec.onend = () => _submitBrowserTranscriptSoon(220);
      try {
        activeRec.stop();
        _setOrbState('thinking');
        _setStatus('Transcribing…', 'Finalizing dictation');
      } catch {
        _submitBrowserTranscriptSoon(0);
      }
      return;
    }
    _submitBrowserTranscriptSoon(0);
  }

  function _startAlwaysListening() {
    if (!_isAlwaysListeningMode()) return;
    if (__pmVoice.listening) return;
    pressArm = false;
    mic.classList.remove('pressed');
    _unlockVoiceAudio();
    _ensureWarmMic().catch((err) => {
      _showDictationFallback(err?.message || _voiceCapabilityNote());
      pmToast('Microphone permission is not available', 'error');
    });
    _startListening();
  }

  function _beginHold(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (_isAlwaysListeningMode()) return;
    if (pressArm) return;
    pressArm = true;
    suppressNextClick = true;
    mic.classList.add('pressed');
    _unlockVoiceAudio();
    _ensureWarmMic().catch((err) => {
      _showDictationFallback(err?.message || _voiceCapabilityNote());
      pmToast('Microphone permission is not available', 'error');
    });
    _startListening();
  }

  function _endHold(abort = false, e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (_isAlwaysListeningMode()) return;
    if (!pressArm) return;
    pressArm = false;
    mic.classList.remove('pressed');
    _stopListening(abort);
  }

  // Hold-to-talk. Safari gets explicit touch handlers so long-press/click
  // synthesis cannot steal the gesture before recording starts.
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (hasTouch) {
    mic.addEventListener('touchstart', _beginHold, { passive: false });
    mic.addEventListener('touchend', (e) => _endHold(false, e), { passive: false });
    mic.addEventListener('touchcancel', (e) => _endHold(true, e), { passive: false });
  } else {
    mic.addEventListener('pointerdown', (e) => {
      try { mic.setPointerCapture?.(e.pointerId); } catch {}
      _beginHold(e);
    });
    mic.addEventListener('pointerup', (e) => _endHold(false, e));
    mic.addEventListener('pointerleave', (e) => _endHold(false, e));
    mic.addEventListener('pointercancel', (e) => _endHold(true, e));
  }
  mic.addEventListener('contextmenu', (e) => e.preventDefault());
  // Single tap also toggles for users who prefer tap-to-record.
  let tapCount = 0;
  mic.addEventListener('click', () => {
    if (suppressNextClick) { suppressNextClick = false; return; }
    if (_isAlwaysListeningMode()) {
      if (__pmVoice.listening) {
        pressArm = false;
        mic.classList.remove('pressed');
        _stopListening(true);
        _setReadyVoiceState();
      } else {
        _startAlwaysListening();
      }
      return;
    }
    tapCount++;
    if (tapCount === 1) {
      setTimeout(() => {
        if (tapCount === 1 && !pressArm) {
          // Toggle mode
          if (__pmVoice.listening) {
            pressArm = false;
            mic.classList.remove('pressed');
            _stopListening(false);
          } else {
            pressArm = true;
            mic.classList.add('pressed');
            _unlockVoiceAudio();
            _ensureWarmMic().catch((err) => {
              _showDictationFallback(err?.message || _voiceCapabilityNote());
              pmToast('Microphone permission is not available', 'error');
            });
            _startListening();
          }
        }
        tapCount = 0;
      }, 220);
    }
  });

  if (ctx?.autoStart === true) setTimeout(() => _runVoiceAutoStart(), 3000);
}

/* ---------------- SCHEDULE ---------------- */
function scheduleCardHtml(s) {
  const next = s.next ? `<div class="pm-kv">${ICONS.clock} Next: <b>${escapeHtml(s.next)}</b></div>` : '';
  const last = s.last ? `<div class="pm-kv">${ICONS.clock} Last: <b>${escapeHtml(s.last)}</b></div>` : '';
  const foot = s.assignedTo
    ? `<span style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--pm-text-soft);">Assigned to: <span class="pm-assign-chip">🤖 ${escapeHtml(s.assignedTo)}</span></span>`
    : `<span><span style="display:block;font-weight:600;color:var(--pm-text-soft)">${escapeHtml(s.footLeft || '')}</span><span style="display:block;font-size:12px;color:var(--pm-muted)">${escapeHtml(s.footRight || '')}</span></span>`;
  return `
    <article class="pm-schedule-card color-${s.color}" data-id="${s.id}">
      <div class="pm-schedule-head">
        <span class="pm-emoji">${s.emoji}</span>
        <h3>${escapeHtml(s.name)}</h3>
        <button class="pm-toggle ${s.enabled ? 'on' : ''}" data-toggle aria-label="Enable schedule"></button>
      </div>
      <div class="pm-tag-row">
        <span class="pm-pill ${s.status}">${escapeHtml(s.status)}</span>
        ${s.builtin ? '<span class="pm-pill builtin">Built-in</span>' : ''}
      </div>
      <p class="pm-schedule-desc">${escapeHtml(s.description)}</p>
      <div class="pm-kv-grid">${next}${last}</div>
      <div class="pm-schedule-foot">
        ${foot}
        <button class="pm-run-btn" data-run>Run Now</button>
      </div>
    </article>
  `;
}

function scheduleSkeletonHtml() {
  const block = `
    <article class="pm-schedule-card" style="opacity:.6">
      <div class="pm-schedule-head">
        <span class="pm-emoji" style="background:rgba(0,0,0,.06);width:24px;height:24px;border-radius:6px;"></span>
        <h3 style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;height:18px;">loading…</h3>
        <button class="pm-toggle" aria-hidden="true"></button>
      </div>
      <p class="pm-schedule-desc" style="background:rgba(0,0,0,.04);color:transparent;border-radius:6px;height:32px;">.</p>
      <div class="pm-kv-grid"><div class="pm-kv">${ICONS.clock} Next: <b>…</b></div><div class="pm-kv">${ICONS.clock} Last: <b>…</b></div></div>
    </article>`;
  return block.repeat(3);
}

export async function renderSchedulePage(page) {
  const initialExtras = `
    <span class="pm-spacer"></span>
    <span class="pm-count-pill" id="pm-sched-count">…</span>
    <button class="pm-cta" aria-label="New schedule">${ICONS.plus} New Schedule</button>
  `;
  const header = renderMobileHeader({ title: 'Schedule', online: true, extras: initialExtras });
  page.innerHTML = `
    ${header}
    <div class="pm-body" id="pm-sched-body">${scheduleSkeletonHtml()}</div>
  `;
  wireHeaderActions(page, {});

  const body = page.querySelector('#pm-sched-body');
  const count = page.querySelector('#pm-sched-count');

  let items = [];
  try {
    items = await loadMobileSchedules();
  } catch (err) {
    console.error('[mobile] schedules load failed', err);
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.calendar}</div><h2>Couldn’t load schedules</h2><p>${escapeHtml(err.message || 'Network error')}</p></div>`;
    count.textContent = '0 schedules';
    return;
  }

  if (!items.length) {
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.calendar}</div><h2>No schedules yet</h2><p>Tap “+ New Schedule” to create your first one.</p></div>`;
    count.textContent = '0 schedules';
    return;
  }

  count.textContent = `${items.length} schedule${items.length === 1 ? '' : 's'}`;
  body.innerHTML = items.map(scheduleCardHtml).join('');

  // Wire toggles + run buttons. Map by id back to the item.
  const byId = new Map(items.map(it => [it.id, it]));
  body.querySelectorAll('.pm-schedule-card').forEach(card => {
    const id = card.getAttribute('data-id');
    const item = byId.get(id);
    if (!item) return;

    const toggle = card.querySelector('[data-toggle]');
    if (toggle) {
      toggle.addEventListener('click', async () => {
        const next = !toggle.classList.contains('on');
        toggle.classList.toggle('on', next);
        toggle.disabled = true;
        try {
          const r = await toggleSchedule(item, next);
          if (!r || r.success === false) throw new Error(r?.error || 'Update failed');
          item.enabled = next;
          pmToast(`${item.name}: ${next ? 'enabled' : 'paused'}`, 'success');
        } catch (err) {
          toggle.classList.toggle('on', !next);
          pmToast(err.message || 'Update failed', 'error');
        } finally {
          toggle.disabled = false;
        }
      });
    }

    const runBtn = card.querySelector('[data-run]');
    if (runBtn) {
      runBtn.addEventListener('click', async () => {
        const prev = runBtn.textContent;
        runBtn.textContent = 'Running…';
        runBtn.disabled = true;
        try {
          const r = await runScheduleNow(item);
          if (!r || r.success === false) throw new Error(r?.error || 'Run failed');
          pmToast(`${item.name} triggered`, 'success');
        } catch (err) {
          pmToast(err.message || 'Run failed', 'error');
        } finally {
          runBtn.textContent = prev;
          runBtn.disabled = false;
        }
      });
    }
  });
}

/* ---------------- TEAMS OVERVIEW ---------------- */
function teamTileHtml(t) {
  const houseColor = t.house === 'blue' ? '#4a82d1' : '#a4682b';
  return `
    <button class="pm-team-tile ${t.featured ? 'featured' : ''}" data-team="${t.id}">
      ${t.featured ? '<span class="pm-star">★</span>' : ''}
      <span class="pm-house" style="color:${houseColor}">🏠</span>
      <span class="pm-team-name">${escapeHtml(t.name)}</span>
      <span class="pm-team-agents">${ICONS.users} ${t.agents} agents</span>
    </button>
  `;
}

function teamsSkeletonHtml() {
  const tile = `<div class="pm-team-tile" style="opacity:.55"><span class="pm-house" style="opacity:.4">🏠</span><span class="pm-team-name" style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;height:16px;width:80%;">loading</span></div>`;
  return `<div class="pm-team-grid">${tile.repeat(4)}</div>`;
}

export async function renderTeamsPage(page, { navigate }) {
  const extras = `
    <span class="pm-count-pill" id="pm-teams-count">…</span>
    <span class="pm-spacer"></span>
    <button class="pm-icon-btn" id="pm-teams-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>
  `;
  const header = renderMobileHeader({ title: 'Teams', online: false, extras });
  page.innerHTML = `
    ${header}
    <div class="pm-body" id="pm-teams-body">${teamsSkeletonHtml()}</div>
  `;
  wireHeaderActions(page, {});

  const body = page.querySelector('#pm-teams-body');
  const countEl = page.querySelector('#pm-teams-count');
  const refresh = page.querySelector('#pm-teams-refresh');

  async function paint() {
    let teams = [];
    try {
      teams = await loadMobileTeams();
    } catch (err) {
      body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.users}</div><h2>Couldn’t load teams</h2><p>${escapeHtml(err.message || 'Network error')}</p></div>`;
      countEl.textContent = '0 teams';
      return;
    }

    countEl.textContent = `${teams.length} team${teams.length === 1 ? '' : 's'}`;
    if (!teams.length) {
      body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.users}</div><h2>No teams yet</h2><p>Create your first team from the desktop app.</p></div>`;
      return;
    }

    const featured = teams.find(t => t.featured) || teams[0];
    let detail = null;
    try { detail = await loadMobileTeamDetail(featured.id); } catch {}

    const previewHtml = detail ? `
      <div class="pm-team-preview">
        <div class="pm-team-preview-head">
          <span class="pm-mini-house">${escapeHtml(detail.emoji || '🏠')}</span>
          <h3>${escapeHtml(detail.name)}</h3>
          <button class="pm-pill-btn" data-go="${escapeHtml(detail.id)}">View Team ${ICONS.chev}</button>
        </div>
        <div style="font-size:13px;color:var(--pm-muted);font-weight:700;margin-top:4px;">Team members</div>
        <div class="pm-chip-row">
          ${detail.members.map(m => `<span class="pm-member-chip"><span class="pm-avatar" style="background:${m.color}">${m.avatar}</span>${escapeHtml(m.name)}</span>`).join('')}
        </div>
        <div class="pm-divider"></div>
        <div class="pm-row"><span>🗂️ Workspace</span><span style="color:var(--pm-muted)">${escapeHtml(detail.workspace)} ${ICONS.chev}</span></div>
        <div class="pm-divider"></div>
        <div class="pm-row" style="flex-direction:column;align-items:stretch;gap:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>Progress</strong>
            <span style="color:var(--pm-muted)">Recent runs <b style="color:var(--pm-text)">${detail.runsDone} / ${detail.runsTotal} runs</b></span>
          </div>
          <div class="pm-progress"><span style="width:${detail.runsTotal ? Math.round((detail.runsDone/detail.runsTotal)*100) : 0}%"></span></div>
        </div>
      </div>
    ` : '';

    body.innerHTML = `
      <div class="pm-team-grid">${teams.map(teamTileHtml).join('')}</div>
      ${previewHtml}
    `;
    body.querySelectorAll('[data-team]').forEach(btn => {
      btn.addEventListener('click', () => navigate(`#mobile/teams/${btn.getAttribute('data-team')}`));
    });
    body.querySelectorAll('[data-go]').forEach(btn => {
      btn.addEventListener('click', () => navigate(`#mobile/teams/${btn.getAttribute('data-go')}`));
    });
  }

  refresh.addEventListener('click', () => {
    invalidateTeamsCache();
    body.innerHTML = teamsSkeletonHtml();
    paint();
  });

  await paint();
}

/* ---------------- TEAM DETAIL ---------------- */
function teamDetailSkeleton() {
  return `
    <div class="pm-detail-head"><span class="pm-house-icon">🏠</span><h1 style="background:rgba(0,0,0,.06);color:transparent;border-radius:8px;height:24px;flex:1;">loading</h1></div>
    <div class="pm-detail-sub">…</div>
    <div class="pm-action-row">
      <button class="pm-action-btn primary">${ICONS.play} Start Run</button>
      <button class="pm-action-btn">${ICONS.pause} Pause</button>
      <button class="pm-action-btn">${ICONS.brain} Review</button>
      <button class="pm-action-btn danger">${ICONS.trash} Delete</button>
    </div>
    <div class="pm-card" style="opacity:.5"><div class="pm-card-head">${ICONS.target} Purpose</div><div class="pm-card-body">Loading team…</div></div>
  `;
}

export async function renderTeamDetailPage(page, { teamId, navigate, initialTab = '' }) {
  // Paint shell + skeleton first
  page.innerHTML = `
    <header class="pm-header">
      <button class="pm-icon-btn" data-action="back" aria-label="Back">${ICONS.back}</button>
      <div class="pm-brand">${FLAME}<span>Prometheus</span></div>
      <button class="pm-icon-btn" data-action="settings" aria-label="Settings">${ICONS.gear}</button>
    </header>
    <div class="pm-body" id="pm-detail-body">${teamDetailSkeleton()}</div>
  `;
  wireHeaderActions(page, { onBack: () => navigate('#mobile/teams') });

  const body = page.querySelector('#pm-detail-body');

  let t = null;
  try {
    t = await loadMobileTeamDetail(teamId);
  } catch (err) {
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.users}</div><h2>Couldn’t load team</h2><p>${escapeHtml(err.message || 'Network error')}</p></div>`;
    return;
  }
  if (!t) {
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.users}</div><h2>Team not found</h2><p>This team isn’t available right now.</p></div>`;
    return;
  }

  const tabs = ['Context','Subagents','Workspace','Memory','Runs','Team Chat'];
  body.innerHTML = `
    <div class="pm-detail-head">
      <span class="pm-house-icon" style="color:#d8473a">${escapeHtml(t.emoji || '🎟️')}</span>
      <h1>${escapeHtml(t.name)}</h1>
      <button class="pm-icon-btn pm-overflow" aria-label="More">${ICONS.dots}</button>
    </div>
    <div class="pm-detail-sub">${t.subagents} subagents · ${t.totalRuns} total runs</div>

    <div class="pm-action-row">
      <button class="pm-action-btn primary" data-act="start">${ICONS.play} Start Run</button>
      <button class="pm-action-btn"          data-act="pause">${t.paused ? ICONS.play + ' Resume' : ICONS.pause + ' Pause'}</button>
      <button class="pm-action-btn"          data-act="review">${ICONS.brain} Review</button>
      <button class="pm-action-btn danger"   data-act="delete">${ICONS.trash} Delete</button>
    </div>

    <div class="pm-tabs" role="tablist">
      ${tabs.map((tab, i) => `<button class="${i === 0 ? 'active' : ''}" data-tab="${tab}">${escapeHtml(tab)}</button>`).join('')}
    </div>

    <div id="pm-tab-slot"></div>

    <div id="pm-context-slot">
    <div class="pm-team-preview">
      <div class="pm-team-preview-head">
        <span class="pm-mini-house">${escapeHtml(t.emoji || '🏠')}</span>
        <h3>${escapeHtml(t.name)}</h3>
      </div>
      <div style="font-size:13px;color:var(--pm-muted);">${t.subagents} subagents · ${t.totalRuns} total runs</div>
      <div class="pm-chip-row">
        ${t.members.map(m => `<span class="pm-member-chip"><span class="pm-avatar" style="background:${m.color}">${m.avatar}</span>${escapeHtml(m.name)}</span>`).join('')}
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>${ICONS.target} Purpose</span>
        <button class="pm-show-more" data-toggle-purpose>Show more ▾</button>
      </div>
      <div class="pm-card-body" data-purpose data-collapsed="1" style="display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(t.purpose)}</div>
    </div>

    <div class="pm-card-grid">
      <div class="pm-card">
        <div class="pm-card-head">${ICONS.check} Current Task / Goal</div>
        <div class="pm-card-body">${escapeHtml(t.currentTask)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${ICONS.clock} Last Run</div>
        <div class="pm-card-body strong">${escapeHtml(t.lastRun)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${ICONS.users} Member States</div>
        <div class="pm-card-body">${escapeHtml(t.memberStates)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${ICONS.send} Active Dispatches</div>
        <div class="pm-card-body">${escapeHtml(t.dispatches)}</div>
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head">${ICONS.doc} Context &amp; Reference</div>
      <div class="pm-card-body" style="margin-bottom:10px;">Each save adds a new card. Cards are injected into manager + subagent runtime context.</div>
      <input class="pm-input" id="pm-ref-title" placeholder="Reference title (e.g. Brand Voice, API URL, Posting Rules)" />
      <textarea class="pm-textarea" id="pm-ref-body" placeholder="Reference content…"></textarea>
      <div class="pm-row-buttons">
        <button class="pm-btn ghost" disabled title="Upload coming soon">${ICONS.upload} Upload File</button>
        <button class="pm-btn primary" data-save-ref>${ICONS.check} Save</button>
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>📁 Workspace Preview</span>
        <a href="#mobile/teams/${escapeHtml(teamId)}/workspace" style="color:var(--pm-orange);font-weight:700;text-decoration:none;font-size:13px;">Open Workspace ›</a>
      </div>
      <div class="pm-card-body">${escapeHtml(t.workspace)}</div>
    </div>
    </div><!-- /pm-context-slot -->
  `;

  // Tabs: swap visible content between context (default) and other tabs.
  const contextSlot = body.querySelector('#pm-context-slot');
  const tabSlot     = body.querySelector('#pm-tab-slot');

  async function selectTab(tabName) {
    try { tabSlot?._pmCleanup?.(); } catch {}
    if (tabSlot) tabSlot._pmCleanup = null;
    body.querySelectorAll('.pm-tabs button').forEach(x => x.classList.toggle('active', x.getAttribute('data-tab') === tabName));
    if (tabName === 'Context') {
      contextSlot.style.display = '';
      tabSlot.innerHTML = '';
      return;
    }
    contextSlot.style.display = 'none';
    tabSlot.innerHTML = `<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading ${escapeHtml(tabName)}…</div>`;
    try {
      if (tabName === 'Subagents')  await _renderSubagentsTab(tabSlot, t);
      else if (tabName === 'Runs')   await _renderRunsTab(tabSlot, teamId);
      else if (tabName === 'Team Chat') await _renderTeamChatTab(tabSlot, teamId);
      else if (tabName === 'Workspace') await _renderWorkspaceTab(tabSlot, teamId);
      else if (tabName === 'Memory')    await _renderMemoryTab(tabSlot, teamId, t);
    } catch (err) {
      tabSlot.innerHTML = `<div class="pm-card"><div class="pm-card-head">${ICONS.users} Error</div><div class="pm-card-body">${escapeHtml(err.message || 'Failed to load')}</div></div>`;
    }
  }

  body.querySelectorAll('.pm-tabs button').forEach(b => {
    b.addEventListener('click', () => selectTab(b.getAttribute('data-tab')));
  });
  const initialTabName = tabs.find(tab => tab.toLowerCase().replace(/\s+/g, '-') === String(initialTab || '').toLowerCase());
  if (initialTabName && initialTabName !== 'Context') selectTab(initialTabName);

  // Show more / less for purpose
  const purposeToggle = body.querySelector('[data-toggle-purpose]');
  const purposeBody = body.querySelector('[data-purpose]');
  if (purposeToggle && purposeBody) {
    purposeToggle.addEventListener('click', () => {
      const collapsed = purposeBody.getAttribute('data-collapsed') === '1';
      if (collapsed) {
        purposeBody.style.webkitLineClamp = 'unset';
        purposeBody.style.display = 'block';
        purposeBody.setAttribute('data-collapsed', '0');
        purposeToggle.textContent = 'Show less ▴';
      } else {
        purposeBody.style.display = '-webkit-box';
        purposeBody.style.webkitLineClamp = '6';
        purposeBody.setAttribute('data-collapsed', '1');
        purposeToggle.textContent = 'Show more ▾';
      }
    });
  }

  // Action buttons
  async function _action(btn, fn, doneMsg) {
    const prev = btn.innerHTML;
    btn.disabled = true;
    btn.style.opacity = '0.6';
    try {
      const r = await fn();
      if (!r || r.success === false) throw new Error(r?.error || 'Failed');
      pmToast(doneMsg, 'success');
      return r;
    } catch (err) {
      pmToast(err.message || 'Action failed', 'error');
      throw err;
    } finally {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.innerHTML = prev;
    }
  }

  body.querySelectorAll('[data-act]').forEach(btn => {
    const act = btn.getAttribute('data-act');
    btn.addEventListener('click', async () => {
      if (act === 'start') {
        await _action(btn, () => startTeamRun(teamId), 'Run started').catch(() => {});
      } else if (act === 'pause') {
        const willResume = t.paused;
        try {
          await _action(btn, () => (willResume ? resumeTeam(teamId) : pauseTeam(teamId)), willResume ? 'Team resumed' : 'Team paused');
          t.paused = !willResume;
          btn.innerHTML = t.paused ? `${ICONS.play} Resume` : `${ICONS.pause} Pause`;
        } catch {}
      } else if (act === 'review') {
        await _action(btn, () => triggerTeamReview(teamId), 'Manager review triggered').catch(() => {});
      } else if (act === 'delete') {
        if (!window.confirm(`Delete team "${t.name}"? This cannot be undone.`)) return;
        try {
          await _action(btn, () => deleteTeam(teamId), 'Team deleted');
          invalidateTeamsCache();
          navigate('#mobile/teams');
        } catch {}
      }
    });
  });

  // Save context reference
  const saveBtn = body.querySelector('[data-save-ref]');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const titleEl = body.querySelector('#pm-ref-title');
      const bodyEl  = body.querySelector('#pm-ref-body');
      const title = (titleEl.value || '').trim();
      const text  = (bodyEl.value  || '').trim();
      if (!title || !text) { pmToast('Title and content required', 'error'); return; }
      try {
        await _action(saveBtn, () => saveTeamContextReference(teamId, title, text), 'Reference saved');
        titleEl.value = '';
        bodyEl.value  = '';
      } catch {}
    });
  }

  page._pmCleanup = () => {
    try { tabSlot?._pmCleanup?.(); } catch {}
  };
}

/* ---------------- PLACEHOLDER ---------------- */
/* ---------------- TEAM DETAIL TABS ---------------- */

function _comingSoonHtml(title, subtitle) {
  return `<div class="pm-empty" style="padding:40px 20px;"><div class="pm-empty-icon">${ICONS.spark}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div>`;
}

const PRESENCE_PILL = {
  working:  { label: 'working',  cls: 'running' },
  active:   { label: 'active',   cls: 'active' },
  ready:    { label: 'ready',    cls: 'active' },
  idle:     { label: 'idle',     cls: 'gray' },
  blocked:  { label: 'blocked',  cls: 'orange' },
  paused:   { label: 'paused',   cls: 'gray' },
  awaiting: { label: 'awaiting', cls: 'orange' },
  offline:  { label: 'offline',  cls: 'gray' },
};

function _formatTimeAgo(ms) {
  if (!ms) return 'Never';
  const delta = Date.now() - ms;
  if (delta < 0) return new Date(ms).toLocaleString();
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

function _formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

async function _renderSubagentsTab(slot, team) {
  let roomState = null;
  try { roomState = await loadTeamRoomState(team.id); } catch {}
  const states = roomState?.memberStates || {};
  const dispatches = Array.isArray(roomState?.activeDispatches) ? roomState.activeDispatches : [];
  const activeByAgent = new Map();
  for (const d of dispatches) {
    const id = String(d.agentId || d.subagentId || '').trim();
    if (id) activeByAgent.set(id, d);
  }

  const cards = team.members.filter(m => m.id !== 'manager').map(m => {
    const s = states[m.id] || {};
    const pill = PRESENCE_PILL[String(s.status || 'idle').toLowerCase()] || PRESENCE_PILL.idle;
    const active = activeByAgent.get(m.id);
    return `
      <article class="pm-card">
        <div class="pm-schedule-head" style="margin-bottom:8px;">
          <span class="pm-emoji" style="font-size:22px;">${m.avatar}</span>
          <h3 style="margin:0;">${escapeHtml(m.name)}</h3>
          <span class="pm-pill ${pill.cls}">${pill.label}</span>
        </div>
        ${s.currentTask ? `<div class="pm-card-body" style="margin-bottom:6px;"><strong>Current:</strong> ${escapeHtml(s.currentTask)}</div>` : ''}
        ${s.blockedReason ? `<div class="pm-card-body" style="color:var(--pm-red);margin-bottom:6px;"><strong>Blocked:</strong> ${escapeHtml(s.blockedReason)}</div>` : ''}
        ${s.lastResult ? `<div class="pm-card-body" style="font-size:13px;color:var(--pm-muted);margin-bottom:6px;">Last: ${escapeHtml(String(s.lastResult).slice(0, 140))}${String(s.lastResult).length > 140 ? '…' : ''}</div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--pm-muted);">
          <span>${active ? `📡 dispatched` : 'Last update'}</span>
          <span>${_formatTimeAgo(s.lastUpdateAt || active?.startedAt)}</span>
        </div>
      </article>
    `;
  }).join('');

  slot.innerHTML = cards || `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.robot}</div><h2>No subagents yet</h2><p>Add members from the desktop team editor.</p></div>`;
}

function _runStatusPill(run) {
  if (run.inProgress) return '<span class="pm-pill running">running</span>';
  if (run.success === true) return '<span class="pm-pill active">success</span>';
  if (run.success === false && run.taskStatus) return `<span class="pm-pill orange">${escapeHtml(String(run.taskStatus))}</span>`;
  return '<span class="pm-pill gray">complete</span>';
}

async function _renderRunsTab(slot, teamId) {
  const { runs } = await loadTeamRuns(teamId, 30);
  if (!runs.length) {
    slot.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clock}</div><h2>No runs yet</h2><p>Start a run from the top of this page.</p></div>`;
    return;
  }
  slot.innerHTML = runs.map(r => `
    <article class="pm-card" style="padding:14px 16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <strong style="flex:1;font-size:14px;">${escapeHtml(r.agentName || r.agentId || 'Agent')}</strong>
        ${_runStatusPill(r)}
      </div>
      ${r.taskSummary ? `<div class="pm-card-body" style="margin-bottom:6px;">${escapeHtml(String(r.taskSummary).slice(0, 200))}${String(r.taskSummary).length > 200 ? '…' : ''}</div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--pm-muted);">
        <span>${escapeHtml(r.trigger || 'manual')} · ${r.stepCount || 0} steps</span>
        <span>${_formatTimeAgo(r.startedAt)} · ${_formatDuration(r.durationMs)}</span>
      </div>
    </article>
  `).join('');
}

function _mobileReplayFrameToEvent(frame) {
  if (!frame) return null;
  return { type: String(frame.type || frame.event || ''), ...(frame.data || {}) };
}

function _pushMobileStreamProcessEntry(message, type, text, extra = null) {
  const clean = String(text || '').trim();
  if (!message || !clean) return;
  if (!Array.isArray(message.processEntries)) message.processEntries = [];
  const key = `${type}:${clean}`.slice(0, 260);
  if (message.processEntries.some((entry) => String(entry?._key || '') === key)) return;
  message.processEntries.push({
    _key: key,
    type,
    text: clean.length > 420 ? `${clean.slice(0, 420)}...` : clean,
    extra,
    time: _nowTime(),
  });
  if (message.processEntries.length > 80) {
    message.processEntries.splice(0, message.processEntries.length - 80);
  }
}

function _renderMobileStreamProcess(message) {
  const sourceEntries = [
    ...(Array.isArray(message?.processEntries) ? message.processEntries : []),
    ...(Array.isArray(message?.metadata?.processEntries) ? message.metadata.processEntries : []),
  ];
  const entries = sourceEntries.length
    ? sourceEntries.map((entry) => ({
        ...entry,
        type: String(entry?.type || 'info'),
        text: String(entry?.text || entry?.content || '').trim(),
      })).filter((entry) => entry.text)
    : [];
  return _renderMobileProcess(entries);
}

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

function _renderMobileAgentChatBubble(message, options = {}) {
  const role = String(message?.role || message?.from || options.role || 'agent').toLowerCase();
  const fromUser = role === 'user' || role === 'you' || role === 'human';
  const timeValue = message?.createdAt || message?.timestamp || message?.ts;
  const time = timeValue ? _formatTimeAgo(timeValue) : '';
  const text = String(message?.content || message?.message || message?.text || message?.body?.text || '').replace(/\n\n\[UPLOADED FILES\][\s\S]*$/, '').trim();
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
  let inner = '';
  if (fromUser) {
    inner = `<div class="markdown-body">${_renderMobileMarkdown(text)}</div>${attachmentHtml}`;
  } else {
    const sender = String(options.sender || message?.fromLabel || message?.body?.sender || message?.fromName || 'Agent');
    inner += _renderMobileWorkTimer(assistantLike);
    inner += `<span class="pm-sender">${escapeHtml(sender)}</span>`;
    inner += progress;
    inner += text
      ? `<div class="markdown-body">${_renderMobileMarkdown(text)}</div>`
      : (streaming ? `<div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>` : '');
    inner += attachmentHtml;
    inner += _renderMobileMediaGallery(_collectMessageMedia({
      ...message,
      files: _mobileAgentMessageFiles(message),
      artifacts: Array.isArray(message?.artifacts) ? message.artifacts : (Array.isArray(message?.metadata?.artifacts) ? message.metadata.artifacts : []),
    }));
    inner += _renderMobileFileChanges(_mobileAgentMessageFileChanges(message));
    if (message?.approvalRequest) {
      inner += `<div class="pm-chat-approvals-inline">${_renderMobileApprovalCard(message.approvalRequest, { compact: false })}</div>`;
    }
    inner += _renderMobileStreamProcess(message);
  }
  return `
    <div class="pm-msg ${fromUser ? 'from-user' : 'from-ai'}" style="max-width:92%;margin-bottom:10px;"${streaming && !fromUser ? ' data-streaming="1"' : ''}>
      <div class="pm-bubble">
        ${inner}
        ${time ? `<span class="pm-time">${escapeHtml(time)}</span>` : ''}
      </div>
    </div>`;
}

function _renderMobileAgentComposerHtml(prefix, placeholder) {
  const id = String(prefix || 'pm-agent-chat');
  return `
    <form class="pm-composer pm-agent-chat-composer" id="${id}-form" style="position:relative;left:auto;right:auto;bottom:auto;margin:0;border-radius:0;border-left:0;border-right:0;border-bottom:0;box-shadow:none;">
      <input id="${id}-file-input" type="file" multiple accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.avi,.mkv,.txt,.md,.json,.csv,.tsv,.log,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.yaml,.yml,application/pdf" hidden />
      <div class="pm-attach-tray" id="${id}-attach-tray" hidden></div>
      <div class="pm-composer-row">
        <button type="button" class="pm-icon-btn" id="${id}-attach-btn" aria-label="Attach files">${ICONS.paperclip}</button>
        <textarea class="pm-composer-input" id="${id}-input" rows="1" placeholder="${escapeHtml(placeholder)}" aria-label="Message" autocomplete="off" autocapitalize="sentences" enterkeyhint="send"></textarea>
        <button type="submit" class="pm-send" id="${id}-send-btn" aria-label="Send">${ICONS.send}</button>
      </div>
    </form>`;
}

function _installMobileAgentComposer(slot, prefix, { placeholder, isBusy, onSubmit, onAbort }) {
  const id = String(prefix || 'pm-agent-chat');
  const form = slot.querySelector(`#${id}-form`);
  const input = slot.querySelector(`#${id}-input`);
  const sendBtn = slot.querySelector(`#${id}-send-btn`);
  const attachBtn = slot.querySelector(`#${id}-attach-btn`);
  const fileInput = slot.querySelector(`#${id}-file-input`);
  const attachTray = slot.querySelector(`#${id}-attach-tray`);
  const pending = [];

  const resize = () => {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(148, Math.max(30, input.scrollHeight || 30))}px`;
  };
  const hasOutbound = () => !!(String(input?.value || '').trim() || pending.length);
  const renderAttachments = () => {
    if (!attachTray) return;
    attachTray.hidden = pending.length === 0;
    attachTray.innerHTML = _renderChatAttachmentPreviews(pending, true);
    attachTray.querySelectorAll('[data-remove-attachment]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-remove-attachment'));
        if (Number.isFinite(idx)) pending.splice(idx, 1);
        renderAttachments();
        update();
      });
    });
  };
  const update = () => {
    const busy = !!isBusy?.();
    const abortMode = busy && !hasOutbound();
    if (input) input.placeholder = busy ? `Queue a message...` : placeholder;
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.classList.toggle('is-abort', abortMode);
      sendBtn.title = abortMode ? 'Stop' : busy ? 'Queue message' : 'Send';
      sendBtn.setAttribute('aria-label', abortMode ? 'Stop' : busy ? 'Queue message' : 'Send');
      sendBtn.innerHTML = abortMode
        ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>`
        : ICONS.send;
    }
  };
  const consume = () => {
    const text = String(input?.value || '').trim();
    const files = pending.splice(0, pending.length);
    if (input) {
      input.value = '';
      resize();
    }
    renderAttachments();
    update();
    return { text, files };
  };

  input?.addEventListener('input', () => { resize(); update(); });
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form?.requestSubmit?.();
    }
  });
  input?.addEventListener('paste', async (event) => {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    if (!String(event.clipboardData?.getData?.('text/plain') || '').trim()) event.preventDefault();
    const normalized = await Promise.all(files.slice(0, 8).map(_normalizeMobileFile));
    pending.push(...normalized.filter(Boolean));
    renderAttachments();
    update();
  });
  attachBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []).slice(0, 8);
    fileInput.value = '';
    if (!files.length) return;
    const normalized = await Promise.all(files.map(_normalizeMobileFile));
    pending.push(...normalized.filter(Boolean));
    renderAttachments();
    update();
  });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isBusy?.() && !hasOutbound()) {
      onAbort?.();
      update();
      return;
    }
    const payload = consume();
    if (!payload.text && !payload.files.length) return;
    await onSubmit?.(payload);
    update();
  });

  requestAnimationFrame(() => { resize(); update(); });
  return { input, update, consume, pending };
}

function _applyMobileAgentStreamEvent(message, evt, fallbackName = 'Agent') {
  if (!message || !evt) return false;
  const type = String(evt.type || '').trim();
  switch (type) {
    case 'token': {
      const chunk = String(evt.text || '');
      if (!chunk) return false;
      message.content = `${message.content || ''}${chunk}`;
      message.text = message.content;
      message.body = { ...(message.body || {}), text: message.content };
      message._progress = '';
      return true;
    }
    case 'thinking_delta': {
      const chunk = String(evt.thinking || evt.text || '');
      if (!chunk) return false;
      message._thinking = `${message._thinking || ''}${chunk}`;
      message._progress = `${fallbackName} is thinking...`;
      return true;
    }
    case 'thinking':
    case 'agent_thought': {
      const thought = String(evt.thinking || evt.text || '').trim();
      if (!thought) return false;
      message._thinking = message._thinking ? `${message._thinking}\n\n${thought}` : thought;
      _pushMobileStreamProcessEntry(message, 'think', thought, evt.actor ? { actor: evt.actor } : null);
      message._progress = `${fallbackName} is thinking...`;
      return true;
    }
    case 'info':
    case 'heartbeat': {
      const info = String(evt.message || evt.current_step || evt.state || '').trim();
      if (!info || /^processing$/i.test(info)) return false;
      message._progress = info.slice(0, 140);
      _pushMobileStreamProcessEntry(message, 'info', info, evt.actor ? { actor: evt.actor } : null);
      return true;
    }
    case 'progress_state': {
      const items = Array.isArray(evt.items) ? evt.items : [];
      const activeIndex = Number(evt.activeIndex || -1);
      const activeText = String(activeIndex >= 0 ? items[activeIndex]?.text || '' : '').trim();
      if (!activeText) return false;
      message._progress = activeText.slice(0, 140);
      return true;
    }
    case 'tool_call': {
      const action = String(evt.action || evt.name || evt.toolName || 'tool').trim();
      const stepNum = Number(evt.stepNum || 0);
      const stepPrefix = stepNum ? `Step ${stepNum}: ` : '';
      const args = evt.args && typeof evt.args === 'object' ? JSON.stringify(evt.args).slice(0, 180) : '';
      message._progress = `Running ${action}...`;
      _pushMobileStreamProcessEntry(message, 'tool', `${stepPrefix}${action}${args ? ` ${args}` : ''}`, evt.actor ? { actor: evt.actor } : null);
      return true;
    }
    case 'tool_result': {
      const action = String(evt.action || evt.name || evt.toolName || 'tool').trim();
      const text = String(evt.result || evt.output || '').trim();
      const ok = evt.error === true ? false : !/^ERROR:/i.test(text);
      try { _collectMediaFromToolEvent(message, evt); } catch {}
      if (evt.fileChanges) message.fileChanges = evt.fileChanges;
      if (evt.productCarousel) _mergeMobileProductCarouselIntoMessage(message, evt.productCarousel);
      if (Array.isArray(evt.richArtifacts) && evt.richArtifacts.length) message.richArtifacts = evt.richArtifacts;
      message._progress = ok ? '' : `${action} failed`;
      _pushMobileStreamProcessEntry(message, ok ? 'result' : 'error', `${action}${text ? ` -> ${text}` : ' complete'}`, evt.actor ? { actor: evt.actor } : null);
      return true;
    }
    case 'tool_progress': {
      const action = String(evt.action || evt.name || evt.toolName || 'tool').trim();
      const text = String(evt.message || '').trim();
      if (!text) return false;
      message._progress = `${action}: ${text}`.slice(0, 140);
      _pushMobileStreamProcessEntry(message, 'info', `${action}: ${text}`, evt.actor ? { actor: evt.actor } : null);
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
      const text = String(evt.text || evt.reply || '').trim();
      try { _collectMediaFromToolEvent(message, evt); } catch {}
      if (evt.fileChanges) message.fileChanges = evt.fileChanges;
      if (evt.productCarousel) _mergeMobileProductCarouselIntoMessage(message, evt.productCarousel);
      if (Array.isArray(evt.richArtifacts) && evt.richArtifacts.length) message.richArtifacts = evt.richArtifacts;
      if (text && !String(message.content || '').trim()) {
        message.content = text;
        message.text = text;
        message.body = { ...(message.body || {}), text };
      }
      message._progress = '';
      return true;
    }
    case 'done': {
      const text = String(evt.reply || evt.text || '').trim();
      try { _collectMediaFromToolEvent(message, evt); } catch {}
      if (evt.fileChanges) message.fileChanges = evt.fileChanges;
      if (evt.productCarousel) _mergeMobileProductCarouselIntoMessage(message, evt.productCarousel);
      if (Array.isArray(evt.richArtifacts) && evt.richArtifacts.length) message.richArtifacts = evt.richArtifacts;
      if (text && !String(message.content || '').trim()) {
        message.content = text;
        message.text = text;
        message.body = { ...(message.body || {}), text };
      }
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
      _pushMobileStreamProcessEntry(message, 'error', err);
      return true;
    }
    default:
      return false;
  }
}

async function _renderTeamChatTab(slot, teamId) {
  slot.innerHTML = `
    <div class="pm-card" id="pm-team-chat-card" style="padding:0;overflow:hidden;">
      <div id="pm-team-chat-list" style="max-height:55vh;overflow-y:auto;padding:14px 14px 8px;"></div>
      <div id="pm-team-chat-queue" class="pm-mobile-queued-prompts" hidden></div>
      ${_renderMobileAgentComposerHtml('pm-team-chat', 'Message the team manager...')}
    </div>
  `;

  const listEl = slot.querySelector('#pm-team-chat-list');
  const queueEl = slot.querySelector('#pm-team-chat-queue');
  let messages = [];
  let liveMsg = null;
  let currentStream = null;
  let lastSeq = 0;
  let lastStreamId = '';
  let localSseActive = false;
  let cleanupDone = false;
  const sendQueue = [];
  let approvalCards = [];
  let composer = null;

  const isBusy = () => !!(currentStream || liveMsg?.streaming || localSseActive);
  const approvalBelongsHere = (approvalInput = {}) => {
    const approval = _normalizeMobileApproval(approvalInput);
    const sid = String(approval.sessionId || approval.sourceSessionId || '').trim();
    return !!approval.id && (
      sid.startsWith(`team_dm_manager_${teamId}___`)
      || sid.startsWith(`team_dm_member_${teamId}___`)
      || sid === `team_chat_${teamId}`
      || String(approval.teamId || approval.toolArgs?.teamId || '').trim() === String(teamId)
    );
  };
  const upsertApprovalCard = (approvalInput = {}) => {
    if (!approvalBelongsHere(approvalInput)) return false;
    const approval = _normalizeMobileApproval(approvalInput);
    const idx = approvalCards.findIndex((item) => String(item?.approvalRequest?.id || '') === approval.id);
    const msg = {
      role: 'agent',
      from: 'manager',
      fromLabel: 'Manager',
      content: '',
      createdAt: Date.now(),
      approvalRequest: approval,
    };
    if (idx >= 0) approvalCards[idx] = { ...approvalCards[idx], approvalRequest: { ...(approvalCards[idx].approvalRequest || {}), ...approval } };
    else approvalCards.push(msg);
    approvalCards = approvalCards.slice(-8);
    return true;
  };
  const updateApprovalCard = (id, status, event = {}) => {
    const approvalId = String(id || '').trim();
    if (!approvalId) return false;
    const idx = approvalCards.findIndex((item) => String(item?.approvalRequest?.id || '') === approvalId);
    if (idx < 0) return false;
    approvalCards[idx].approvalRequest = _normalizeMobileApproval({ ...(approvalCards[idx].approvalRequest || {}), ...(event.approval || event), id: approvalId, status });
    return true;
  };
  const restoreApprovalCards = async () => {
    const pending = await loadMobileApprovals('pending').catch(() => []);
    (Array.isArray(pending) ? pending : []).forEach(upsertApprovalCard);
  };

  function renderQueue() {
    if (!queueEl) return;
    queueEl.hidden = sendQueue.length === 0;
    queueEl.innerHTML = sendQueue.length
      ? `<div class="pm-mobile-queued-head"><span>Queued messages</span><b>${sendQueue.length}</b></div>
         <div class="pm-mobile-queued-list">${sendQueue.map((item, idx) => `
           <div class="pm-mobile-queued-item">
             <button type="button" class="pm-mobile-queued-text" data-team-queue-edit="${idx}">${escapeHtml(String(item.text || 'Attached file(s)').slice(0, 120))}${item.files?.length ? ` <em>+${item.files.length}</em>` : ''}</button>
             <div class="pm-mobile-queued-actions"><button type="button" class="pm-mobile-queued-icon pm-mobile-queued-remove" data-team-queue-remove="${idx}" aria-label="Remove queued message">${ICONS.trash}</button></div>
           </div>`).join('')}</div>`
      : '';
    queueEl.querySelectorAll('[data-team-queue-remove]').forEach((btn) => btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-team-queue-remove'));
      if (Number.isFinite(idx)) sendQueue.splice(idx, 1);
      renderQueue();
    }));
  }

  function drainQueueSoon() {
    if (isBusy() || !sendQueue.length) {
      composer?.update?.();
      return;
    }
    const next = sendQueue.shift();
    renderQueue();
    startTeamMobileSend(next).catch((err) => pmToast(err?.message || 'Send failed', 'error'));
  }

  function upsertServerMessages(fresh) {
    const localLive = liveMsg && !liveMsg._done ? liveMsg : null;
    messages = Array.isArray(fresh) ? fresh.slice() : [];
    if (localLive) {
      const duplicate = messages.some((m) =>
        String(m.content || m.message || m.text || '').trim()
        && String(m.content || m.message || m.text || '').trim() === String(localLive.content || '').trim()
      );
      if (!duplicate) messages.push(localLive);
    }
  }

  function renderList() {
    const visibleApprovals = approvalCards.filter((m) => String(m?.approvalRequest?.status || 'pending') === 'pending');
    const rendered = [...messages, ...visibleApprovals];
    if (!rendered.length) {
      listEl.innerHTML = `<div style="text-align:center;color:var(--pm-muted);padding:24px 8px;font-size:13px;">No messages yet. Send the first one.</div>`;
      return;
    }
    listEl.innerHTML = rendered.map((m) => _renderMobileAgentChatBubble(m, {
      sender: m.fromLabel || m.fromName || 'Manager',
      live: m === liveMsg,
    })).join('');
    listEl.querySelectorAll('[data-pm-approval-action][data-pm-approval-id]').forEach((btn) => {
      btn.addEventListener('click', () => _resolveMobileApprovalButton(btn));
    });
    _wireMobileProcessRunActions(listEl);
    listEl.scrollTop = listEl.scrollHeight;
  }

  try {
    upsertServerMessages(await loadTeamChat(teamId, 80));
    await restoreApprovalCards();
    renderList();
  } catch (err) {
    listEl.innerHTML = `<div style="color:var(--pm-red);padding:16px;">${escapeHtml(err.message || 'Failed to load chat')}</div>`;
  }

  async function reconcile({ forceHistory = false } = {}) {
    try {
      const replay = await loadTeamChatStreamReplay(teamId, lastStreamId ? lastSeq : 0);
      if (replay.stream?.streamId && replay.stream.streamId !== lastStreamId) {
        lastStreamId = replay.stream.streamId;
        lastSeq = 0;
      }
      if (replay.stream?.streamId && !liveMsg && replay.active) {
        liveMsg = { role: 'manager', from: 'manager', fromLabel: 'Manager', content: '', _progress: 'Reconnecting...', createdAt: Date.now(), workStartedAt: Date.now(), streaming: true, processEntries: [] };
        messages.push(liveMsg);
      }
      for (const frame of replay.events || []) {
        if (frame.streamId) lastStreamId = frame.streamId;
        lastSeq = Math.max(lastSeq, Number(frame.seq || 0));
        if (!liveMsg) {
          liveMsg = { role: 'manager', from: 'manager', fromLabel: 'Manager', content: '', _progress: 'Reconnecting...', createdAt: Date.now(), workStartedAt: Date.now(), streaming: true, processEntries: [] };
          messages.push(liveMsg);
        }
        _applyMobileAgentStreamEvent(liveMsg, _mobileReplayFrameToEvent(frame), 'Manager');
      }
      if (forceHistory || !replay.active || liveMsg?._done) {
        upsertServerMessages(await loadTeamChat(teamId, 80));
        await restoreApprovalCards();
        if (!replay.active) liveMsg = null;
      }
      renderList();
    } catch {}
  }

  const onWsOpen = () => reconcile({ forceHistory: true });
  const onVisibility = () => { if (!document.hidden) reconcile({ forceHistory: true }); };
  const onTeamChatMessage = async (msg = {}) => {
    if (String(msg.teamId || '') !== String(teamId)) return;
    try {
      upsertServerMessages(await loadTeamChat(teamId, 80));
      liveMsg = null;
      renderList();
    } catch {}
  };
  const onTeamChatStreamEvent = (msg = {}) => {
    if (String(msg.teamId || '') !== String(teamId)) return;
    if (localSseActive) return;
    if (msg.streamId && msg.streamId !== lastStreamId) {
      lastStreamId = msg.streamId;
      lastSeq = 0;
    }
    lastSeq = Math.max(lastSeq, Number(msg.seq || 0));
    if (!liveMsg) {
      liveMsg = { role: 'manager', from: 'manager', fromLabel: 'Manager', content: '', _progress: 'Thinking...', createdAt: Date.now(), workStartedAt: Date.now(), streaming: true, processEntries: [] };
      messages.push(liveMsg);
    }
    _applyMobileAgentStreamEvent(liveMsg, { type: String(msg.event || ''), ...(msg.data || {}) }, 'Manager');
    renderList();
  };
  const onApprovalCreated = async (msg = {}) => {
    const approval = msg.approval ? _normalizeMobileApproval(msg.approval, msg) : await _approvalFromMobileEvent(msg);
    if (upsertApprovalCard(approval)) renderList();
  };
  const onApprovalResolved = (eventName) => (msg = {}) => {
    const status = eventName === 'approval_approved' ? 'approved'
      : eventName === 'approval_denied' ? 'rejected'
        : eventName === 'approval_expired' ? 'expired'
          : 'failed';
    if (updateApprovalCard(msg.approvalId || msg.id || msg.approval?.id, status, msg)) renderList();
  };
  const onApprovalApproved = onApprovalResolved('approval_approved');
  const onApprovalDenied = onApprovalResolved('approval_denied');
  const onApprovalExpired = onApprovalResolved('approval_expired');
  const onApprovalFailed = onApprovalResolved('approval_failed');
  wsEventBus?.on?.('ws:open', onWsOpen);
  wsEventBus?.on?.('team_chat_message', onTeamChatMessage);
  wsEventBus?.on?.('team_chat_stream_event', onTeamChatStreamEvent);
  wsEventBus?.on?.('approval_created', onApprovalCreated);
  wsEventBus?.on?.('approval_approved', onApprovalApproved);
  wsEventBus?.on?.('approval_denied', onApprovalDenied);
  wsEventBus?.on?.('approval_expired', onApprovalExpired);
  wsEventBus?.on?.('approval_failed', onApprovalFailed);
  document.addEventListener('visibilitychange', onVisibility);
  slot._pmCleanup = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    try { currentStream?.abort?.(); } catch {}
    wsEventBus?.off?.('ws:open', onWsOpen);
    wsEventBus?.off?.('team_chat_message', onTeamChatMessage);
    wsEventBus?.off?.('team_chat_stream_event', onTeamChatStreamEvent);
    wsEventBus?.off?.('approval_created', onApprovalCreated);
    wsEventBus?.off?.('approval_approved', onApprovalApproved);
    wsEventBus?.off?.('approval_denied', onApprovalDenied);
    wsEventBus?.off?.('approval_expired', onApprovalExpired);
    wsEventBus?.off?.('approval_failed', onApprovalFailed);
    document.removeEventListener('visibilitychange', onVisibility);
  };
  reconcile();

  async function startTeamMobileSend(payload) {
    const rawText = String(payload?.text || '').trim();
    const files = Array.isArray(payload?.files) ? payload.files : [];
    const userVisibleText = rawText || (files.length ? 'Please review the attached file(s).' : '');
    if (!userVisibleText && !files.length) return;
    if (isBusy()) {
      sendQueue.push({ text: rawText, files });
      renderQueue();
      composer?.update?.();
      return;
    }
    let messageForRuntime = userVisibleText;
    let attachmentPreviews = files;
    if (files.length) {
      const uploadResults = await _uploadMobileChatAttachments(files);
      messageForRuntime = `${userVisibleText}${_buildMobileFileContextNote(uploadResults)}`;
      attachmentPreviews = uploadResults.map((r, idx) => ({
        ...(files[idx] || {}),
        name: r.name || files[idx]?.name || 'attachment',
        kind: r.isImage ? 'image' : (r.isVideo ? 'video' : (files[idx]?.kind || 'file')),
        workspacePath: r.workspacePath || files[idx]?.workspacePath,
        path: r.workspacePath || files[idx]?.path,
        dataUrl: files[idx]?.dataUrl,
        mimeType: files[idx]?.mimeType,
        sizeLabel: files[idx]?.sizeLabel,
      }));
    }
    const userMsg = { role: 'user', from: 'user', content: messageForRuntime, body: { text: messageForRuntime, attachments: attachmentPreviews }, attachmentPreviews, createdAt: Date.now() };
    liveMsg = { role: 'manager', from: 'manager', fromLabel: 'Manager', content: '', _progress: 'Manager is thinking...', createdAt: Date.now(), workStartedAt: Date.now(), streaming: true, processEntries: [] };
    messages.push(userMsg, liveMsg);
    renderList();
    localSseActive = true;
    composer?.update?.();
    currentStream = streamTeamChat(teamId, { message: messageForRuntime }, {
      onEvent: (evt) => {
        _applyMobileAgentStreamEvent(liveMsg, evt, 'Manager');
        renderList();
      },
      onError: (err) => {
        if (err?.name === 'AbortError') return;
        liveMsg.content = liveMsg.content || `Error: ${err?.message || 'stream failed'}`;
        liveMsg._progress = '';
        liveMsg.streaming = false;
        liveMsg.workEndedAt = Date.now();
        localSseActive = false;
        currentStream = null;
        composer?.update?.();
        renderList();
        pmToast(err?.message || 'Send failed', 'error');
      },
      onDone: async () => {
        if (liveMsg) {
          liveMsg._progress = '';
          liveMsg.streaming = false;
          liveMsg.workEndedAt = liveMsg.workEndedAt || Date.now();
          liveMsg.workDurationMs = Math.max(0, liveMsg.workEndedAt - Number(liveMsg.workStartedAt || liveMsg.createdAt || liveMsg.workEndedAt));
        }
        localSseActive = false;
        currentStream = null;
        composer?.update?.();
        await reconcile({ forceHistory: true });
        drainQueueSoon();
      },
    });
  }

  composer = _installMobileAgentComposer(slot, 'pm-team-chat', {
    placeholder: 'Message the team manager...',
    isBusy,
    onAbort: () => {
      try { currentStream?.abort?.(); } catch {}
      if (liveMsg) {
        liveMsg._progress = 'Stopping...';
        liveMsg.streaming = false;
      }
      currentStream = null;
      localSseActive = false;
      renderList();
    },
    onSubmit: startTeamMobileSend,
  });
  renderQueue();
}

/* ---------------- WORKSPACE TAB ---------------- */

function _fileIcon(name) {
  const n = String(name || '').toLowerCase();
  if (/\.(md|markdown|txt)$/.test(n))    return '📝';
  if (/\.(js|ts|tsx|jsx|mjs|cjs)$/.test(n)) return '📜';
  if (/\.(json|yaml|yml|toml)$/.test(n)) return '🔧';
  if (/\.(png|jpg|jpeg|gif|svg|webp)$/.test(n)) return '🖼️';
  if (/\.(mp4|mov|webm|mkv)$/.test(n))   return '🎬';
  if (/\.(mp3|wav|ogg|flac)$/.test(n))   return '🎵';
  if (/\.(html|htm)$/.test(n))           return '🌐';
  if (/\.(pdf)$/.test(n))                return '📄';
  return '📃';
}

function _formatFileBytes(n) {
  if (!n || n < 1024) return `${n || 0} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function _renderWorkspaceTab(slot, teamId) {
  slot.innerHTML = `<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading workspace…</div>`;
  let ws;
  try { ws = await loadTeamWorkspace(teamId); } catch (err) {
    slot.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.doc}</div><h2>Couldn’t load workspace</h2><p>${escapeHtml(err.message || '')}</p></div>`;
    return;
  }

  const files = ws.files || [];
  if (!files.length) {
    slot.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.doc}</div><h2>Workspace is empty</h2><p>Files written by team subagents will appear here.</p></div>`;
    return;
  }

  slot.innerHTML = `
    <div class="pm-card" style="padding:10px 12px 12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <strong style="font-size:13px;">${files.length} file${files.length === 1 ? '' : 's'}</strong>
        ${ws.workspacePath ? `<span style="font-size:11px;color:var(--pm-muted);font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%;">${escapeHtml(ws.workspacePath)}</span>` : ''}
      </div>
      <div id="pm-ws-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div id="pm-ws-preview" style="margin-top:12px;display:none;"></div>
    </div>
  `;
  const listEl = slot.querySelector('#pm-ws-list');
  const previewEl = slot.querySelector('#pm-ws-preview');

  listEl.innerHTML = files.map(f => {
    const relpath = f.relpath || f.path || f.name || '';
    const size = f.size || 0;
    const updated = f.modifiedAt || f.updatedAt;
    return `
      <button type="button" data-rel="${escapeHtml(relpath)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:12px;padding:10px 12px;cursor:pointer;font-family:inherit;">
        <span style="font-size:18px;">${_fileIcon(relpath)}</span>
        <span style="flex:1;min-width:0;overflow:hidden;">
          <span style="display:block;font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(relpath)}</span>
          <span style="display:block;font-size:11px;color:var(--pm-muted);">${_formatFileBytes(size)}${updated ? ' · ' + _formatTimeAgo(typeof updated === 'number' ? updated : new Date(updated).getTime()) : ''}</span>
        </span>
        <span style="color:var(--pm-muted);">${ICONS.chev}</span>
      </button>
    `;
  }).join('');

  listEl.querySelectorAll('[data-rel]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rel = btn.getAttribute('data-rel');
      previewEl.style.display = 'block';
      previewEl.innerHTML = `<div class="pm-card-body" style="padding:14px;color:var(--pm-muted);">Loading ${escapeHtml(rel)}…</div>`;
      try {
        const r = await loadTeamWorkspaceFile(teamId, rel);
        const text = r?.content || r?.body || '';
        previewEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <strong style="flex:1;font-size:13px;">${escapeHtml(rel)}</strong>
            <button class="pm-btn ghost" id="pm-ws-close" style="padding:4px 10px;font-size:12px;">✕ Close</button>
          </div>
          <pre style="background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:10px;padding:12px;font-size:12px;line-height:1.5;font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;margin:0;">${escapeHtml(String(text).slice(0, 50000))}${String(text).length > 50000 ? '\n\n…(truncated)' : ''}</pre>
        `;
        previewEl.querySelector('#pm-ws-close').addEventListener('click', () => { previewEl.style.display = 'none'; previewEl.innerHTML = ''; });
        previewEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (err) {
        previewEl.innerHTML = `<div class="pm-card-body" style="color:var(--pm-red);">${escapeHtml(err.message || 'Failed to load file')}</div>`;
      }
    });
  });
}

/* ---------------- MEMORY TAB ---------------- */

async function _renderMemoryTab(slot, teamId, team) {
  slot.innerHTML = `<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading memory…</div>`;
  let graph;
  try { graph = await loadMemoryGraph(); } catch (err) {
    slot.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.brain}</div><h2>Couldn’t load memory</h2><p>${escapeHtml(err.message || '')}</p></div>`;
    return;
  }

  let nodes = Array.isArray(graph?.nodes) ? graph.nodes.slice() : [];
  // Prefer entries that look team-relevant: matching projectId, or path containing the team id/name.
  const teamId2 = String(teamId).toLowerCase();
  const teamName = String(team?.name || '').toLowerCase();
  const matchesTeam = (n) => {
    const p = String(n.sourcePath || '').toLowerCase();
    const pj = String(n.projectId || '').toLowerCase();
    return (pj && pj.includes(teamId2)) || (p && (p.includes(teamId2) || (teamName && p.includes(teamName))));
  };
  const teamNodes = nodes.filter(matchesTeam);
  const display = (teamNodes.length ? teamNodes : nodes)
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, 30);

  if (!display.length) {
    slot.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.brain}</div><h2>No memory yet</h2><p>As the team works, reflections and memory entries land here.</p></div>`;
    return;
  }

  slot.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 4px 10px;color:var(--pm-muted);font-size:12px;">
      <span class="pm-pill ${teamNodes.length ? 'orange' : 'gray'}">${teamNodes.length ? 'team-scoped' : 'global feed'}</span>
      <span>${display.length} of ${nodes.length} entries</span>
    </div>
    ${display.map(n => `
      <article class="pm-card" style="padding:12px 14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <strong style="flex:1;font-size:13px;line-height:1.3;">${escapeHtml(n.label || 'Memory')}</strong>
          <span class="pm-pill gray" style="font-family:ui-monospace,monospace;">${escapeHtml(n.sourceTypeLabel || n.sourceType || 'memory')}</span>
        </div>
        ${n.summary ? `<div class="pm-card-body" style="margin-bottom:4px;">${escapeHtml(String(n.summary).slice(0, 240))}${String(n.summary).length > 240 ? '…' : ''}</div>` : ''}
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--pm-muted);">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;font-family:ui-monospace,monospace;">${escapeHtml(n.sourcePath || '')}</span>
          <span>${n.timestamp ? _formatTimeAgo(new Date(n.timestamp).getTime()) : ''}</span>
        </div>
      </article>
    `).join('')}
  `;
}

/* ---------------- PAIRING ---------------- */

function _deviceFingerprint() {
  try {
    let fp = localStorage.getItem('pm_device_fp');
    if (!fp) {
      fp = (crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2)));
      localStorage.setItem('pm_device_fp', fp);
    }
    return fp;
  } catch { return 'unknown'; }
}

function _pairRequestCacheKey(code) {
  return `pm_pair_request_${encodeURIComponent(String(code || '').trim()).slice(0, 180)}`;
}

function _loadPairRequestCache(code) {
  try {
    const key = _pairRequestCacheKey(code);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.requestId) return null;
    const expiresAt = Number(cached.expiresAt || 0);
    if (expiresAt && expiresAt < Date.now() - 30_000) {
      sessionStorage.removeItem(key);
      return null;
    }
    return cached;
  } catch { return null; }
}

function _storePairRequestCache(code, request) {
  try {
    if (!request?.requestId) return;
    sessionStorage.setItem(_pairRequestCacheKey(code), JSON.stringify({
      requestId: request.requestId,
      expiresAt: request.expiresAt || (Date.now() + 10 * 60 * 1000),
    }));
  } catch {}
}

function _clearPairRequestCache(code) {
  try { sessionStorage.removeItem(_pairRequestCacheKey(code)); } catch {}
}

function _suggestedDeviceName() {
  const ua = navigator.userAgent || '';
  if (/iPhone/i.test(ua))  return 'iPhone';
  if (/iPad/i.test(ua))    return 'iPad';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua))   return 'Windows';
  return 'Mobile device';
}

async function _ensureAccountBeforePairing(setStage) {
  const current = getAccount();
  if (current?.accessActive || current?.purchaseActive || current?.subscriptionActive || current?.isAdmin) return true;
  const result = await checkSessionDetailed({ timeoutMs: 3000 }).catch(() => null);
  const account = result?.account || getAccount();
  if (result?.authenticated && (account?.accessActive || account?.purchaseActive || account?.subscriptionActive || account?.isAdmin)) return true;

  setStage({
    title: 'Sign in to pair',
    sub: 'Use your Prometheus account first. After login, this phone will ask the desktop for approval.',
    status: '',
    actions: '',
  });

  await new Promise((resolve) => {
    mountLoginScreen(() => resolve(true));
  });
  return true;
}

export async function renderPairPage(page, { code, navigate }) {
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Pair phone', online: false, leftIcon: 'menu' })}
    <div class="pm-body" style="display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:8px;">
      <div id="pm-pair-stage" style="max-width:360px;width:100%;">
        <div class="pm-voice-orb" style="width:min(60vw,200px);margin:14px auto 24px;" aria-hidden="true">
          <svg viewBox="0 0 200 200" style="width:100%;height:100%;">
            <defs>
              <radialGradient id="pm-pair-core" cx="35%" cy="32%" r="70%">
                <stop offset="0%" stop-color="#fff6e6" stop-opacity="0.95"/>
                <stop offset="40%" stop-color="#ffd9a8" stop-opacity="0.55"/>
                <stop offset="100%" stop-color="#ea6a1f" stop-opacity="0.25"/>
              </radialGradient>
            </defs>
            <circle cx="100" cy="100" r="92" fill="url(#pm-pair-core)"/>
            <text x="100" y="118" text-anchor="middle" font-size="64" font-family="system-ui">🔗</text>
          </svg>
        </div>
        <h2 id="pm-pair-title" style="margin:0 0 6px;font-size:22px;font-weight:800;letter-spacing:-.3px;">Connecting to Prometheus…</h2>
        <p id="pm-pair-sub" style="margin:0 0 18px;color:var(--pm-muted);font-size:14px;line-height:1.5;">Waiting for approval on your desktop.</p>
        <div id="pm-pair-status" style="font-size:13px;color:var(--pm-text-soft);"></div>
        <div id="pm-pair-actions" style="margin-top:24px;display:flex;flex-direction:column;gap:8px;"></div>
      </div>
    </div>
  `;
  wireHeaderActions(page, {});

  const titleEl  = page.querySelector('#pm-pair-title');
  const subEl    = page.querySelector('#pm-pair-sub');
  const statusEl = page.querySelector('#pm-pair-status');
  const actions  = page.querySelector('#pm-pair-actions');

  function setStage({ title, sub, status, actions: acts }) {
    if (title != null)  titleEl.textContent = title;
    if (sub != null)    subEl.textContent   = sub;
    if (status != null) statusEl.innerHTML  = status;
    if (acts != null)   actions.innerHTML   = acts;
  }

  if (code) {
    await _ensureAccountBeforePairing(setStage);
  }

  // 0. Already paired? Skip the dance and just go home.
  if (getDeviceToken()) {
    const me = await verifyPairingMe();
    if (me?.success) {
      setStage({ title: 'Already paired', sub: `Welcome back, ${me.device?.name || 'device'}.`, status: '', actions: `<button class="pm-btn primary" id="pm-pair-go">Continue</button>` });
      page.querySelector('#pm-pair-go').addEventListener('click', () => navigate('#mobile/chat'));
      setTimeout(() => navigate('#mobile/chat'), 800);
      return;
    }
    clearDeviceToken();
  }

  if (!code) {
    setStage({
      title: 'Pair this phone',
      sub: 'Open Prometheus on your desktop, go to Settings > Pairing. Scan the QR, or enter the pair code here from the Home Screen app.',
      status: '',
      actions: `
        <form id="pm-pair-code-form" style="display:flex;flex-direction:column;gap:10px;">
          <input id="pm-pair-code-input" inputmode="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="PAIR-ABCD-1234" style="width:100%;box-sizing:border-box;border:1px solid var(--pm-border);border-radius:12px;background:var(--pm-bg-soft);color:var(--pm-text);padding:14px 16px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:18px;font-weight:800;letter-spacing:.08em;" />
          <button class="pm-btn primary" type="submit">Pair with code</button>
          <button class="pm-btn ghost" type="button" id="pm-pair-retry">I scanned the QR</button>
        </form>`,
    });
    const form = page.querySelector('#pm-pair-code-form');
    const input = page.querySelector('#pm-pair-code-input');
    input?.focus?.();
    input?.addEventListener('input', () => { input.value = String(input.value || '').toUpperCase(); });
    form?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const typedCode = String(input?.value || '').trim();
      if (!typedCode) {
        statusEl.innerHTML = '<span style="color:var(--pm-red);">Enter the pair code from desktop Settings.</span>';
        return;
      }
      window.location.href = `${window.location.origin}/?pair=${encodeURIComponent(typedCode)}#mobile/pair`;
    });
    page.querySelector('#pm-pair-retry')?.addEventListener('click', () => location.reload());
    return;
  }

  if (!code) {
    setStage({
      title: 'Pair this phone',
      sub: 'Open Prometheus on your desktop, go to Settings → Pairing, and scan the QR code that appears.',
      status: '',
      actions: `<button class="pm-btn ghost" id="pm-pair-retry">I’ve already scanned</button>`,
    });
    page.querySelector('#pm-pair-retry').addEventListener('click', () => location.reload());
    return;
  }

  // 1. Claim the QR challenge.
  let requestId;
  try {
    const cachedRequest = _loadPairRequestCache(code);
    if (cachedRequest?.requestId) {
      requestId = cachedRequest.requestId;
      setStage({ status: 'Rejoining pairing request…' });
    } else {
      setStage({ status: 'Sending pairing request…' });
      const r = await claimPairing({
        code,
        deviceName: _suggestedDeviceName(),
        deviceFingerprint: _deviceFingerprint(),
      });
      if (!r?.success || !r.requestId) throw new Error(r?.error || 'Failed to claim');
      requestId = r.requestId;
      _storePairRequestCache(code, r);
    }
  } catch (err) {
    setStage({
      title: 'Couldn’t reach Prometheus',
      sub: err?.body?.error || err.message || 'Failed to claim QR code. It may have expired.',
      status: '',
      actions: `<button class="pm-btn primary" id="pm-pair-newqr">Try a new QR</button>`,
    });
    page.querySelector('#pm-pair-newqr').addEventListener('click', () => {
      window.location.href = window.location.origin + '/#mobile/pair';
    });
    return;
  }

  // 2. Poll for approval.
  setStage({
    title: 'Waiting for approval',
    sub: 'Tap Allow on your desktop to finish pairing.',
    status: '<span style="display:inline-flex;align-items:center;gap:8px;"><span class="pm-pair-spinner" style="display:inline-block;width:14px;height:14px;border:2px solid var(--pm-orange);border-right-color:transparent;border-radius:50%;animation:pm-spin 1s linear infinite;"></span> Listening…</span>',
    actions: `<button class="pm-btn ghost" id="pm-pair-cancel">Cancel</button>`,
  });

  // Inject keyframes for the spinner if not present.
  if (!document.getElementById('pm-pair-anim')) {
    const s = document.createElement('style');
    s.id = 'pm-pair-anim';
    s.textContent = '@keyframes pm-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }

  let cancelled = false;
  page.querySelector('#pm-pair-cancel').addEventListener('click', () => { cancelled = true; navigate('#mobile/chat'); });

  const startedAt = Date.now();
  const POLL_MS = 1500;
  while (!cancelled) {
    if (Date.now() - startedAt > 10 * 60 * 1000) {
      _clearPairRequestCache(code);
      setStage({ title: 'Pairing timed out', sub: 'The request expired. Please ask the desktop for a new QR.', status: '', actions: `<button class="pm-btn primary" id="pm-pair-newqr">Try again</button>` });
      page.querySelector('#pm-pair-newqr').addEventListener('click', () => { window.location.href = window.location.origin + '/#mobile/pair'; });
      return;
    }
    try {
      const r = await pollPairing(requestId);
      if (r.status === 'approved' && r.deviceToken) {
        _clearPairRequestCache(code);
        setDeviceToken(r.deviceToken, r.deviceId);
        // Belt-and-suspenders: write the sticky mobile-mode flag the instant a
        // device token lands. If localStorage later partially loses the token,
        // this flag still keeps the phone in mobile mode (it would just send
        // the user back to the pair screen instead of dropping to desktop UI).
        try { localStorage.setItem('pm_force_mobile', '1'); } catch {}
        setStage({ title: 'Paired!', sub: 'Welcome to Prometheus.', status: '✅', actions: '' });
        setTimeout(() => { window.location.href = window.location.origin + '/#mobile/chat'; }, 900);
        return;
      }
      if (r.status === 'denied') {
        _clearPairRequestCache(code);
        setStage({ title: 'Pairing denied', sub: 'Your desktop user denied this request. You can try again with a new QR.', status: '', actions: `<button class="pm-btn primary" id="pm-pair-newqr">Try again</button>` });
        page.querySelector('#pm-pair-newqr').addEventListener('click', () => { window.location.href = window.location.origin + '/#mobile/pair'; });
        return;
      }
      if (r.status === 'expired' || r.status === 'not_found') {
        _clearPairRequestCache(code);
        setStage({ title: 'QR expired', sub: 'Please generate a fresh QR on your desktop and scan again.', status: '', actions: `<button class="pm-btn primary" id="pm-pair-newqr">Reload</button>` });
        page.querySelector('#pm-pair-newqr').addEventListener('click', () => location.reload());
        return;
      }
    } catch (err) {
      // Network blip — keep trying.
    }
    await new Promise(res => setTimeout(res, POLL_MS));
  }
}

/* ---------------- MORE / HUB / AUDIT / MEMORY ---------------- */

function _pmCompactNumber(value, suffix = '') {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return suffix ? `0${suffix}` : '0';
  if (Math.abs(n) >= 1_000_000_000) return `${Math.round(n / 100_000_000) / 10}B${suffix}`;
  if (Math.abs(n) >= 1_000_000) return `${Math.round(n / 100_000) / 10}M${suffix}`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 100) / 10}K${suffix}`;
  return `${Math.round(n).toLocaleString()}${suffix}`;
}

function _pmDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function _pmGoalTitle(goal) {
  return String(goal?.title || goal?.goal || goal?.userRequest || goal?.summary || goal?.id || 'Latest goal').trim();
}

function _pmGoalBody(goal) {
  return String(goal?.summary || goal?.result || goal?.assistantSummary || goal?.description || goal?.lastAssistantMessage || '').trim();
}

function _pmStatusPill(status) {
  const s = String(status || '').toLowerCase();
  if (['running', 'pending', 'executing'].includes(s)) return `<span class="pm-pill running">running</span>`;
  if (['failed', 'rejected', 'denied'].includes(s)) return `<span class="pm-pill orange">failed</span>`;
  if (['complete', 'completed', 'done', 'approved', 'auto'].includes(s)) return `<span class="pm-pill active">complete</span>`;
  return `<span class="pm-pill gray">${escapeHtml(s || 'unknown')}</span>`;
}

function _pmToolAction(toolName, actionType) {
  const t = String(toolName || '').toLowerCase();
  const a = String(actionType || '').toLowerCase();
  if (a.includes('proposal') || t.includes('proposal')) return 'proposal';
  if (t.includes('delete') || t.includes('remove')) return 'delete';
  if (t.includes('type') || t.includes('fill')) return 'type';
  if (t.includes('click') || t.includes('press')) return 'click';
  if (t.includes('command') || t === 'shell') return 'cmd';
  if (t.includes('write') || t.includes('edit') || t.includes('create') || t.includes('append')) return 'edit';
  if (t.includes('read') || t.includes('list') || t.includes('search') || t.includes('stat') || t.includes('grep')) return 'read';
  return 'other';
}

function _pmAuditStats(runs) {
  const stats = { total: 0, read: 0, edit: 0, delete: 0, type: 0, click: 0, cmd: 0, proposal: 0, approved: 0, rejected: 0, pending: 0 };
  for (const run of runs || []) {
    for (const tool of run.tools || []) {
      stats.total++;
      const action = _pmToolAction(tool.toolName, tool.actionType);
      if (stats[action] !== undefined) stats[action]++;
      const approval = String(tool.approvalStatus || '').toLowerCase();
      if (approval === 'approved') stats.approved++;
      else if (approval === 'rejected') stats.rejected++;
      else if (approval === 'pending') stats.pending++;
    }
  }
  return stats;
}

function _pmTopTools(tools, limit = 3) {
  const counts = new Map();
  for (const tool of tools || []) {
    const name = String(tool.toolName || 'tool');
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function _pmProposalPriority(proposal) {
  const p = String(proposal?.priority || 'medium').toLowerCase();
  const cls = p === 'critical' || p === 'high' ? 'orange' : p === 'low' ? 'gray' : 'blue';
  return `<span class="pm-proposal-badge ${cls}">${escapeHtml(p.toUpperCase())}</span>`;
}

function _pmProposalStatus(proposal) {
  const s = String(proposal?.status || 'pending').toLowerCase();
  if (s === 'pending') return '<span class="pm-proposal-status pending">PENDING</span>';
  if (s === 'executing' || s === 'repairing') return '<span class="pm-proposal-status running">RUNNING</span>';
  if (s === 'executed' || s === 'approved') return '<span class="pm-proposal-status complete">APPROVED</span>';
  if (s === 'denied' || s === 'failed') return '<span class="pm-proposal-status denied">DENIED</span>';
  return `<span class="pm-proposal-status">${escapeHtml(s.toUpperCase())}</span>`;
}

function _pmProposalFiles(proposal, limit = 2) {
  const files = Array.isArray(proposal?.affectedFiles) ? proposal.affectedFiles.slice(0, limit) : [];
  const extra = Array.isArray(proposal?.affectedFiles) ? proposal.affectedFiles.length - files.length : 0;
  const chips = files.map((f) => `<span>${escapeHtml(f?.action || 'touch')}: ${escapeHtml(f?.path || '')}</span>`);
  if (extra > 0) chips.push(`<span>+${extra} more</span>`);
  return chips.length ? `<div class="pm-proposal-files">${chips.join('')}</div>` : '';
}

function _pmProposalSteps(proposal) {
  const steps = Array.isArray(proposal?.executionSteps) ? proposal.executionSteps : [];
  if (!steps.length) return '';
  return `<section class="pm-card pm-more-section"><div class="pm-card-head">Approved Execution Steps</div><div class="pm-proposal-steps">${steps.map((step, idx) => {
    const title = String(step?.title || step?.description || `Step ${idx + 1}`);
    const kind = String(step?.kind || '').trim();
    const success = String(step?.successCriteria || step?.success_criteria || '').trim();
    return `<div class="pm-proposal-step">
      <b>${idx + 1}</b>
      <span><strong>${escapeHtml(title)}</strong>${success ? `<em>Success: ${escapeHtml(success)}</em>` : ''}</span>
      ${kind ? `<small>${escapeHtml(kind.toUpperCase())}</small>` : ''}
    </div>`;
  }).join('')}</div></section>`;
}

function _pmCuratorStatus(suggestion) {
  const s = String(suggestion?.status || 'pending').toLowerCase();
  if (s === 'applied') return '<span class="pm-proposal-status complete">APPLIED</span>';
  if (s === 'rejected') return '<span class="pm-proposal-status denied">DENIED</span>';
  if (s === 'quarantined') return '<span class="pm-proposal-status denied">QUARANTINED</span>';
  return '<span class="pm-proposal-status pending">PENDING</span>';
}

function _pmCuratorMarkdownSection(markdown, heading) {
  const text = String(markdown || '');
  const target = String(heading || '').trim().toLowerCase();
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const m = line.match(/^##\s+(.+?)\s*$/);
    return m && m[1].trim().toLowerCase() === target;
  });
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

function _pmCuratorFirstSentence(text, fallback = '') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  const sentence = cleaned.match(/^(.{30,180}?[.!?])(?:\s|$)/);
  return sentence ? sentence[1].trim() : cleaned.slice(0, 180);
}

function _pmCuratorLesson(s, content) {
  if (s?.learnedBehavior) return String(s.learnedBehavior);
  const action = _pmCuratorMarkdownSection(content, 'Suggested Action');
  const outcome = _pmCuratorMarkdownSection(content, 'Outcome Excerpt');
  const kind = String(s?.change?.kind || '').toLowerCase();
  if (kind === 'manifest_overlay') {
    return _pmCuratorFirstSentence(action || s?.reason, 'Updates routing metadata for this skill.');
  }
  return _pmCuratorFirstSentence(action || outcome || s?.reason, 'Adds a reusable lesson from a completed Prometheus run.');
}

function _pmCuratorApplyPreview(s) {
  if (s?.approvePreview) return String(s.approvePreview);
  const change = s?.change || {};
  const skill = String(s?.skillId || 'this skill');
  const path = String(change.path || '').trim();
  if (String(change.kind || '').toLowerCase() === 'manifest_overlay') return `Approve updates ${skill}'s manifest metadata.`;
  if (String(change.kind || '').toLowerCase() === 'review_only') return `Approve marks this daily skill-change audit accepted without changing skill files.`;
  return `Approve adds ${path || 'a resource file'} to ${skill}.`;
}

function _pmCuratorApproveLabel(s) {
  return String(s?.change?.kind || '').toLowerCase() === 'review_only' ? 'Approve audit' : 'Approve and add';
}

function _pmCuratorCards(suggestions = []) {
  const rows = Array.isArray(suggestions) ? suggestions.slice() : [];
  rows.sort((a, b) => {
    const ap = String(a?.status || '').toLowerCase() === 'pending' ? 0 : 1;
    const bp = String(b?.status || '').toLowerCase() === 'pending' ? 0 : 1;
    return (ap - bp) || String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || ''));
  });
  if (!rows.length) {
    return `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.target}</div><h2>No curator suggestions</h2><p>Brain skill suggestions will appear here when Prometheus finds reusable skill improvements.</p></div>`;
  }
  return rows.map((s) => {
    const change = s?.change || {};
    const evidence = Array.isArray(s?.evidence) ? s.evidence : [];
    const content = String(change.content || '').trim();
    const lesson = _pmCuratorLesson(s, content);
    const applyPreview = _pmCuratorApplyPreview(s);
    const pending = String(s?.status || '').toLowerCase() === 'pending';
    return `<article class="pm-card pm-proposal-card pm-curator-card" data-curator-id="${escapeHtml(s.id || '')}">
      <div class="pm-proposal-head">
        <span class="pm-more-icon">${ICONS.brain}</span>
        <div>
          <strong>${escapeHtml(s.title || 'Untitled skill suggestion')}</strong>
          <div class="pm-proposal-badges">${_pmCuratorStatus(s)}<span>${escapeHtml(String(s.risk || 'low').toUpperCase())} RISK</span><span>${escapeHtml(s.scan?.verdict || 'scan')}</span></div>
        </div>
        <button class="pm-icon-btn" type="button" data-curator-toggle="${escapeHtml(s.id || '')}" aria-label="Toggle details">${ICONS.dots}</button>
      </div>
      <div class="pm-curator-apply-preview">${escapeHtml(applyPreview)}</div>
      <p class="pm-curator-lesson">${escapeHtml(lesson)}</p>
      ${s.futureTrigger ? `<p class="pm-curator-trigger"><strong>Future trigger</strong>${escapeHtml(s.futureTrigger)}</p>` : ''}
      ${s.whyUseful ? `<p class="pm-curator-why">${escapeHtml(s.whyUseful)}</p>` : ''}
      <p>${escapeHtml(s.reason || '')}</p>
      <div class="pm-proposal-files">
        <span>${escapeHtml(s.skillId || 'unknown skill')}</span>
        <span>${escapeHtml(change.path || change.kind || 'change')}</span>
      </div>
      ${evidence.length ? `<div class="pm-curator-evidence">${evidence.slice(0, 3).map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
      <div class="pm-curator-details" id="pm-curator-details-${escapeHtml(s.id || '')}" hidden>
        <div class="pm-more-meta-row"><span>ID</span><span>${escapeHtml(s.id || '')}</span></div>
        <div class="pm-more-meta-row"><span>Updated</span><span>${escapeHtml(_pmDateTime(s.updatedAt))}</span></div>
        ${content ? `<pre>${escapeHtml(content.slice(0, 1800))}${content.length > 1800 ? '\n...' : ''}</pre>` : ''}
      </div>
      <div class="pm-proposal-actions">
        ${pending ? `<button class="pm-btn success pm-proposal-action-btn" data-approve-curator="${escapeHtml(s.id || '')}">${escapeHtml(_pmCuratorApproveLabel(s))}</button><button class="pm-btn danger pm-proposal-action-btn" data-deny-curator="${escapeHtml(s.id || '')}">Deny</button>` : ''}
      </div>
    </article>`;
  }).join('');
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
  if (kind === 'path_access') {
    const p = String(approval?.pathAccess?.requestedPath || args.path || '').trim();
    return {
      title: 'Path access',
      summary: 'Prometheus needs to access a directory outside the workspace.',
      detail: p,
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
  if (approval?.approvalKind === 'dev_source_edit' || tool === 'request_dev_source_edit') return 'Dev source edit approval';
  if (approval?.approvalKind === 'final_action' || tool === 'request_final_action_approval') return 'Final action approval';
  if (tool === 'run_command') return 'Command approval';
  if (tool.startsWith('desktop_')) return 'Desktop action';
  if (tool.startsWith('browser_')) return 'Browser action';
  return 'Tool approval';
}

function _pmApprovalSummary(approval) {
  return _pmHumanApproval(approval).summary;
}

function _pmIsCommandApproval(approval = {}) {
  const tool = String(approval?.toolName || '').trim();
  const kind = String(approval?.approvalKind || '').trim();
  return kind === 'path_access' || kind === 'command'
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

function _pmAppendProcessTerminalChunk(runId, chunk, stream = 'stdout') {
  const id = String(runId || '').trim();
  const el = id ? document.querySelector(`[data-pm-process-output="${_pmCssEscape(id)}"]`) : null;
  const card = id ? document.querySelector(`[data-pm-process-run="${_pmCssEscape(id)}"]`) : null;
  if (!el || !card || !chunk) return;
  const tab = card.getAttribute('data-pm-process-tab') || 'combined';
  if (tab !== 'combined' && tab !== stream) return;
  const wasNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.textContent = `${el.textContent === 'No output yet.' ? '' : el.textContent}${chunk}`;
  if (wasNearBottom) el.scrollTop = el.scrollHeight;
}

function _pmInstallProcessRunLiveStream() {
  if (window.__pmMobileProcessRunLiveInstalled) return;
  window.__pmMobileProcessRunLiveInstalled = true;
  const bus = window.wsEventBus || wsEventBus;
  bus?.on?.('process_run_output', (msg = {}) => {
    const runId = String(msg.run?.runId || msg.runId || '').trim();
    _pmAppendProcessTerminalChunk(runId, String(msg.chunk || ''), String(msg.stream || 'stdout'));
  });
  ['process_run_started', 'process_run_update', 'process_run_exited'].forEach((eventName) => {
    bus?.on?.(eventName, (msg = {}) => {
      const run = msg.run || {};
      const runId = String(run.runId || msg.runId || '').trim();
      const card = runId ? document.querySelector(`[data-pm-process-run="${_pmCssEscape(runId)}"]`) : null;
      if (!card) return;
      const state = String(run.state || run.status || '').toLowerCase();
      const pill = card.querySelector('.pm-process-pill');
      const live = card.querySelector('.pm-process-live-state');
      if (pill && state) {
        pill.textContent = state;
        pill.className = `pm-process-pill ${state}`;
      }
      if (live) live.textContent = state === 'exited' ? 'completed' : 'streaming';
    });
  });
}

_pmInstallProcessRunLiveStream();

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

function _pmRenderCommandRunLink(approval = {}) {
  if (!_pmIsCommandApproval(approval) || !approval.id) return '';
  return `<div class="pm-process-approval-link">
    <button type="button" data-pm-process-action="load-approval" data-approval-id="${escapeHtml(approval.id)}">Open terminal</button>
    <div class="pm-process-approval-host" data-process-approval-host="${escapeHtml(approval.id)}"></div>
  </div>`;
}

async function _pmLoadApprovalProcessRun(approvalId, host) {
  if (!approvalId || !host) return;
  const toggle = host.parentElement?.querySelector?.('[data-pm-process-action="load-approval"]');
  host.dataset.terminalOpen = '1';
  if (toggle) toggle.textContent = 'Close terminal';
  host.innerHTML = '<div class="pm-process-loading">Loading command run...</div>';
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
  } catch (err) {
    host.innerHTML = `<div class="pm-process-loading error">${escapeHtml(err.message || 'Could not load command run')}</div>`;
  }
}

async function _pmRefreshMobileProcessCard(card, tab = '') {
  const runId = String(card?.getAttribute?.('data-pm-process-run') || '').trim();
  if (!runId) return;
  const activeTab = tab || card.getAttribute('data-pm-process-tab') || 'combined';
  const host = card.parentElement;
  try {
    const [runs, log] = await Promise.all([
      loadMobileProcessRuns(100),
      loadMobileProcessRunLog(runId, 200000).catch(() => null),
    ]);
    const run = runs.find((item) => String(item?.runId || '') === runId) || { runId };
    if (host) {
      host.innerHTML = _pmRenderProcessRunCard(run, { log, tab: activeTab });
      _wireMobileProcessRunActions(host);
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

function _pmSparkBars(series, key = 'count', limit = 14) {
  const items = (Array.isArray(series) ? series : []).slice(-limit);
  if (!items.length) return '<div class="pm-more-bars empty"></div>';
  const max = Math.max(1, ...items.map((x) => Number(x?.[key] || x?.tokens || x?.count || 0)));
  return `<div class="pm-more-bars">${items.map((x) => {
    const value = Number(x?.[key] || x?.tokens || x?.count || 0);
    const h = Math.max(8, Math.round((value / max) * 54));
    return `<span style="height:${h}px" title="${escapeHtml(String(value))}"></span>`;
  }).join('')}</div>`;
}

function _pmMemoryDots(nodes, limit = 120) {
  const list = (Array.isArray(nodes) ? nodes : []).slice(0, limit);
  const dots = list.map((node, idx) => {
    const degree = Number(node?.degree || 0);
    const angle = (idx * 137.5) * Math.PI / 180;
    const radius = 8 + Math.sqrt(idx + 1) * 7.2;
    const x = 50 + Math.cos(angle) * Math.min(radius, 43);
    const y = 50 + Math.sin(angle) * Math.min(radius, 43);
    const hue = degree > 6 ? '#ff8a2a' : degree > 3 ? '#a78bfa' : '#55c4ff';
    return `<i style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;background:${hue};"></i>`;
  }).join('');
  return `<div class="pm-memory-orbit" aria-hidden="true"><div class="pm-memory-core"></div>${dots}</div>`;
}

function _parkDesktopMemoryIds() {
  const view = document.getElementById('memory-view');
  if (!view || view.dataset.pmIdsParked === '1') return () => {};
  const changed = [];
  view.querySelectorAll('[id]').forEach((node) => {
    const id = node.getAttribute('id');
    if (!id || !id.startsWith('memory-')) return;
    node.setAttribute('data-pm-original-id', id);
    node.setAttribute('id', `desktop-${id}`);
    changed.push(node);
  });
  view.dataset.pmIdsParked = '1';
  return () => {
    changed.forEach((node) => {
      const original = node.getAttribute('data-pm-original-id');
      if (!original) return;
      node.setAttribute('id', original);
      node.removeAttribute('data-pm-original-id');
    });
    delete view.dataset.pmIdsParked;
  };
}

function _pmMoreSkeleton() {
  return `<div class="pm-more-skeleton"><span></span><span></span><span></span></div>`;
}

function _renderMoreLanding(page, { navigate }) {
  const extras = `<span class="pm-spacer"></span><button class="pm-icon-btn" id="pm-more-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'More', online: true, extras, hideTitle: true, hideBrand: true })}
    <div class="pm-body pm-more-page" id="pm-more-body">
      ${_pmMoreSkeleton()}
    </div>
  `;
  wireHeaderActions(page, {});
  const body = page.querySelector('#pm-more-body');

  const paint = (data) => {
    const latestGoal = data?.hub?.latestGoal;
    const recentRuns = Array.isArray(data?.audit?.runs) ? data.audit.runs : [];
    const recentMemory = Array.isArray(data?.memory?.recent) ? data.memory.recent : [];
    body.innerHTML = `
      <button class="pm-more-card pm-more-card-hub" data-route="#mobile/more/hub" type="button">
        <div class="pm-more-card-top">
          <span class="pm-more-icon">${ICONS.target}</span>
          <span><strong>Hub</strong><em>Usage, goals, and models</em></span>
          <span class="pm-chev">${ICONS.chev}</span>
        </div>
        <div class="pm-more-stats">
          <span><b>${escapeHtml(_pmCompactNumber(data?.hub?.models?.totalTokens || data?.hub?.models?.total || 0))}</b><em>tokens</em></span>
          <span><b>${escapeHtml(_pmCompactNumber(data?.hub?.tools?.toolCalls || data?.hub?.tools?.total || 0))}</b><em>tool calls</em></span>
        </div>
        <div class="pm-more-preview-box">
          <span class="pm-mini-label">Latest goal</span>
          <strong>${escapeHtml(latestGoal ? _pmGoalTitle(latestGoal) : 'No goals yet')}</strong>
          <p>${escapeHtml(latestGoal ? (_pmGoalBody(latestGoal) || String(latestGoal.status || 'In progress')) : 'Goals from the main chat will appear here.')}</p>
        </div>
      </button>

      <button class="pm-more-card pm-more-card-audit" data-route="#mobile/more/audit" type="button">
        <div class="pm-more-card-top">
          <span class="pm-more-icon">${ICONS.clipboard}</span>
          <span><strong>Audit</strong><em>Recent non-main agent runs</em></span>
          <span class="pm-chev">${ICONS.chev}</span>
        </div>
        <div class="pm-run-mini-list">
          ${recentRuns.length ? recentRuns.slice(0, 3).map((run) => `
            <span>
              <b>${escapeHtml(run.kind || run.agentId || 'Agent Run')}</b>
              <em>${escapeHtml(_pmDateTime(run.endedAt || run.startedAt))}</em>
              ${_pmStatusPill(run.status)}
            </span>
          `).join('') : '<p>No agent runs recorded yet.</p>'}
        </div>
      </button>

      <button class="pm-more-card pm-more-card-memory" data-route="#mobile/more/memory" type="button">
        <div class="pm-more-card-top">
          <span class="pm-more-icon">${ICONS.brain}</span>
          <span><strong>Memory</strong><em>Latest graph additions</em></span>
          <span class="pm-chev">${ICONS.chev}</span>
        </div>
        <div class="pm-memory-mini">
          ${_pmMemoryDots(recentMemory, 28)}
          <div class="pm-memory-mini-list">
            ${recentMemory.length ? recentMemory.map((item) => `
              <span><b>${escapeHtml(item.title)}</b><em>${escapeHtml(item.type)} - ${escapeHtml(_pmDateTime(item.timestamp))}</em></span>
            `).join('') : '<p>No non-chat memory graph items yet.</p>'}
          </div>
        </div>
      </button>

      <div class="pm-more-card" style="cursor:default;">
        <div class="pm-more-card-top">
          <span class="pm-more-icon">${ICONS.refresh}</span>
          <span><strong>App health</strong><em>Force a fresh asset reload if the app feels stuck</em></span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;padding-top:6px;">
          <button class="pm-btn ghost" id="pm-more-purge" type="button" style="justify-content:center;">↻ Reload latest assets</button>
          <button class="pm-btn ghost" id="pm-more-repair" type="button" style="justify-content:center;color:var(--pm-red);">🚑 Full reset (re-pair required)</button>
          <span style="font-size:11px;color:var(--pm-muted);line-height:1.5;">Use this if a refresh sends you to the desktop UI, scanning a QR shows the desktop site, or actions stop working after a gateway restart.</span>
        </div>
      </div>
    `;
    body.querySelectorAll('[data-route]').forEach((btn) => btn.addEventListener('click', () => navigate(btn.getAttribute('data-route'))));

    body.querySelector('#pm-more-purge')?.addEventListener('click', async () => {
      pmToast('Refreshing assets…', 'info');
      try { await window.pmPurgeCaches?.(); } catch { window.location.reload(); }
    });
    body.querySelector('#pm-more-repair')?.addEventListener('click', async () => {
      if (!confirm('Full reset will clear caches, sign this device out of pairing, and reload. Continue?')) return;
      try {
        localStorage.removeItem('pm_device_token');
        localStorage.removeItem('pm_device_id');
        localStorage.removeItem('pm_force_mobile');
      } catch {}
      try { await window.pmPurgeCaches?.(); } catch { window.location.reload(); }
    });
  };

  // Render the (navigational) cards immediately with empty previews so the page
  // is instantly usable, then fill in the preview stats once the summary
  // resolves. The previous version blocked on a skeleton until all 5 analytics
  // requests inside loadMobileMoreSummary() finished, which could hang the More
  // page for ~10s on the slowest endpoint.
  paint(null);

  const load = async () => {
    try {
      paint(await loadMobileMoreSummary());
    } catch (err) {
      pmToast(`Could not refresh More: ${err.message || ''}`, 'error');
    }
  };
  page.querySelector('#pm-more-refresh')?.addEventListener('click', load);
  load();
}

async function _renderMoreHub(page, { navigate }) {
  const extras = `<span class="pm-spacer"></span><button class="pm-icon-btn" id="pm-hub-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Hub', leftIcon: 'back', onBack: () => navigate('#mobile/more'), online: true, extras, hideTitle: true, hideBrand: true })}
    <div class="pm-body pm-more-page" id="pm-hub-body">${_pmMoreSkeleton()}</div>
  `;
  wireHeaderActions(page, { onBack: () => navigate('#mobile/more') });
  const body = page.querySelector('#pm-hub-body');
  const load = async () => {
    try {
      body.innerHTML = _pmMoreSkeleton();
      const data = await loadMobileHubOverview();
      const latestGoal = data.goals[0];
      const curator = data.curator || { suggestions: [], pending: 0, quarantined: 0 };
      const curatorSuggestions = Array.isArray(curator.suggestions) ? curator.suggestions : [];
      const curatorLow = curatorSuggestions.filter((s) => String(s.risk || '').toLowerCase() === 'low').length;
      body.innerHTML = `
        <section class="pm-more-detail-hero">
          <div><span class="pm-mini-label">Total tokens</span><strong>${escapeHtml(_pmCompactNumber(data.models.totalTokens || data.models.total || 0))}</strong></div>
          <div><span class="pm-mini-label">Favorite model</span><strong>${escapeHtml(data.models.favorite || data.models.favoriteByTokens || 'none')}</strong></div>
          ${_pmSparkBars(data.modelDaily, 'count', 16)}
        </section>
        <section class="pm-card pm-more-section">
          <div class="pm-card-head">Latest Goal</div>
          <h3>${escapeHtml(latestGoal ? _pmGoalTitle(latestGoal) : 'No goals yet')}</h3>
          <p>${escapeHtml(latestGoal ? (_pmGoalBody(latestGoal) || String(latestGoal.status || 'In progress')) : 'Main chat goals will appear here once Prometheus records them.')}</p>
          <div class="pm-more-meta-row"><span>${escapeHtml(String(latestGoal?.status || ''))}</span><span>${escapeHtml(_pmDateTime(latestGoal?.updatedAt || latestGoal?.completedAt || latestGoal?.createdAt))}</span></div>
        </section>
        <section class="pm-more-grid">
          <span><b>${escapeHtml(_pmCompactNumber(data.tools.toolCalls || data.tools.total || 0))}</b><em>Tool calls</em></span>
          <span><b>${escapeHtml(_pmCompactNumber(data.tools.activeDays || 0))}</b><em>Active days</em></span>
          <span><b>${escapeHtml(data.tools.peakHour || '-')}</b><em>Peak hour</em></span>
          <span><b>${escapeHtml(_pmCompactNumber(data.goals.length))}</b><em>Goals</em></span>
        </section>
        <section class="pm-more-grid">
          <span><b>${escapeHtml(_pmCompactNumber(curator.pending || 0))}</b><em>Curator pending</em></span>
          <span><b>${escapeHtml(_pmCompactNumber(curator.quarantined || 0))}</b><em>Quarantined</em></span>
          <span><b>${escapeHtml(_pmCompactNumber(curatorLow))}</b><em>Low risk</em></span>
          <span><b>${escapeHtml(_pmCompactNumber(curatorSuggestions.length))}</b><em>Total suggestions</em></span>
        </section>
        <section class="pm-card pm-more-section">
          <div class="pm-card-head">Top Models</div>
          <div class="pm-more-list">
            ${(data.topModels || []).slice(0, 5).map((m) => `<span><b>${escapeHtml(m.name)}</b><em>${escapeHtml(_pmCompactNumber(m.tokens || 0))} tokens - ${escapeHtml(_pmCompactNumber(m.calls || 0))} calls</em></span>`).join('') || '<p>No model usage yet.</p>'}
          </div>
        </section>
        <section class="pm-card pm-more-section">
          <div class="pm-card-head">Top Skills</div>
          <div class="pm-more-list">
            ${(data.skills || []).slice(0, 5).map((s) => `<span><b>${escapeHtml(s.name || s.id)}</b><em>${escapeHtml(_pmCompactNumber(s.count || 0))} uses</em></span>`).join('') || '<p>No skill usage yet.</p>'}
          </div>
        </section>
        <section class="pm-card pm-more-section pm-curator-section">
          <div class="pm-card-head">Skill Curator Review</div>
          <p>Brain suggestions waiting to be folded into Prometheus skills.</p>
          <div class="pm-curator-list">${_pmCuratorCards(curatorSuggestions)}</div>
        </section>
      `;
      body.querySelectorAll('[data-curator-toggle]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.stopPropagation();
          const id = btn.getAttribute('data-curator-toggle') || '';
          const detail = document.getElementById(`pm-curator-details-${id}`);
          if (detail) detail.hidden = !detail.hidden;
        });
      });
      const actCurator = async (id, kind, btn) => {
        if (!id) return;
        btn.disabled = true;
        try {
          if (kind === 'approve') await applyMobileSkillCuratorSuggestion(id);
          else await denyMobileSkillCuratorSuggestion(id);
          pmToast(kind === 'approve' ? 'Skill suggestion approved' : 'Skill suggestion denied', 'success');
          await load();
        } catch (err) {
          pmToast('Curator action failed: ' + (err?.message || err), 'error');
          btn.disabled = false;
        }
      };
      body.querySelectorAll('[data-approve-curator]').forEach((btn) => btn.addEventListener('click', (event) => {
        event.stopPropagation();
        actCurator(btn.getAttribute('data-approve-curator'), 'approve', btn);
      }));
      body.querySelectorAll('[data-deny-curator]').forEach((btn) => btn.addEventListener('click', (event) => {
        event.stopPropagation();
        actCurator(btn.getAttribute('data-deny-curator'), 'deny', btn);
      }));
    } catch (err) {
      body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.target}</div><h2>Could not load Hub</h2><p>${escapeHtml(err.message || '')}</p></div>`;
    }
  };
  page.querySelector('#pm-hub-refresh')?.addEventListener('click', load);
  await load();
}

async function _renderMoreAudit(page, { navigate }) {
  const extras = `<span class="pm-spacer"></span><button class="pm-icon-btn" id="pm-audit-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Audit', leftIcon: 'back', onBack: () => navigate('#mobile/more'), online: true, extras, hideTitle: true, hideBrand: true })}
    <div class="pm-body pm-more-page" id="pm-audit-body">${_pmMoreSkeleton()}</div>
  `;
  wireHeaderActions(page, { onBack: () => navigate('#mobile/more') });
  const body = page.querySelector('#pm-audit-body');
  let expanded = '';
  let runs = [];
  const paint = () => {
    const stats = _pmAuditStats(runs);
    body.innerHTML = `
      <div class="pm-audit-filter-row">
        <label>${ICONS.chat}<input id="pm-audit-search" type="search" placeholder="Filter by tool or activity..." value=""></label>
        <button type="button" id="pm-audit-clear">${ICONS.refresh}</button>
      </div>
      <div class="pm-audit-stat-grid">
        ${[
          ['total', stats.total], ['read', stats.read], ['edit', stats.edit], ['delete', stats.delete], ['type', stats.type],
          ['click', stats.click], ['cmd', stats.cmd], ['proposal', stats.proposal], ['approved', stats.approved], ['rejected', stats.rejected], ['pending', stats.pending],
        ].map(([label, value]) => `<span class="${label}"><b>${escapeHtml(_pmCompactNumber(value))}</b><em>${escapeHtml(String(label).toUpperCase())}</em></span>`).join('')}
      </div>
      ${runs.length ? `<div class="pm-audit-run-list">${runs.slice(0, 40).map((run) => {
      const isOpen = expanded === run.key;
      const tools = Array.isArray(run.tools) ? run.tools.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))) : [];
      const topTools = _pmTopTools(tools);
      return `<article class="pm-card pm-audit-run-card" data-run-key="${escapeHtml(run.key)}">
        <div class="pm-audit-run-top">
          <span><strong>${escapeHtml(_pmDateTime(run.endedAt || run.startedAt).split(',')[0] || '')}</strong><em>${escapeHtml(new Date(run.endedAt || run.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }))}</em></span>
          <span><strong>${escapeHtml(run.kind || 'Agent Run')}</strong><em>${escapeHtml(run.agentId || 'agent')}</em></span>
          ${_pmStatusPill(run.status)}
        </div>
        <p>${tools.length} tools - Top activity: ${escapeHtml(topTools.map(([name, count]) => `${name} (${count})`).join(', ') || 'none')}</p>
        <div class="pm-more-meta-row"><span>${escapeHtml(run.sessionId || run.key)}</span><span>${isOpen ? 'Collapse' : 'Open'}</span></div>
        ${isOpen ? `<div class="pm-audit-tool-stream">
          ${tools.map((tool) => `<div><b>${escapeHtml(tool.toolName || 'tool')}</b><em>${escapeHtml(tool.actionType || 'event')} - ${escapeHtml(_pmDateTime(tool.timestamp))}</em><span>${escapeHtml(_pmToolAction(tool.toolName, tool.actionType).toUpperCase())}</span>${tool.error ? `<p>${escapeHtml(String(tool.error).slice(0, 240))}</p>` : ''}</div>`).join('')}
        </div>` : ''}
      </article>`;
    }).join('')}</div>` : `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clipboard}</div><h2>No agent runs yet</h2><p>Non-main agent activity will show up here.</p></div>`}
    `;
    body.querySelectorAll('[data-run-key]').forEach((card) => card.addEventListener('click', () => {
      const key = card.getAttribute('data-run-key') || '';
      expanded = expanded === key ? '' : key;
      paint();
    }));
    const search = body.querySelector('#pm-audit-search');
    const clear = body.querySelector('#pm-audit-clear');
    search?.addEventListener('input', () => {
      const q = String(search.value || '').trim().toLowerCase();
      body.querySelectorAll('.pm-audit-run-card').forEach((card) => {
        card.hidden = q && !card.textContent.toLowerCase().includes(q);
      });
    });
    clear?.addEventListener('click', load);
  };
  const load = async () => {
    try {
      body.innerHTML = _pmMoreSkeleton();
      runs = await loadMobileAuditRuns(200);
      paint();
    } catch (err) {
      body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clipboard}</div><h2>Could not load Audit</h2><p>${escapeHtml(err.message || '')}</p></div>`;
    }
  };
  page.querySelector('#pm-audit-refresh')?.addEventListener('click', load);
  await load();
}

async function _renderMoreMemory(page, { navigate }) {
  const restoreDesktopMemoryIds = _parkDesktopMemoryIds();
  const extras = `<span class="pm-spacer"></span><button class="pm-icon-btn" type="button" onclick="refreshMemoryGraph(true)" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Memory Graph', leftIcon: 'back', onBack: () => navigate('#mobile/more'), online: true, extras, hideTitle: true, hideBrand: true })}
    <div class="pm-body pm-mobile-memory-body" id="pm-memory-body">
      <div class="memory-page-shell pm-mobile-memory-shell">
        <div class="memory-page-header pm-mobile-memory-actions">
          <input id="memory-image-input" type="file" accept="image/*" style="display:none" />
          <button class="memory-action-btn memory-action-btn--primary" type="button" onclick="openAddMemoryDrawer()">+ Add Memory</button>
          <button class="memory-action-btn" type="button" onclick="triggerMemoryImageInput()">Image Shape</button>
          <button id="memory-set-default-btn" class="memory-action-btn" type="button" style="opacity:0.4" onclick="toggleDefaultShape()">Set Image Default</button>
        </div>
        <div class="memory-page-body">
          <div class="memory-graph-panel">
            <div class="memory-graph-toolbar">
              <input id="memory-search-input" class="memory-search-input" type="text" placeholder="Search nodes, summaries, paths..." />
              <div id="memory-graph-stats" class="memory-graph-stats">Loading graph...</div>
            </div>
            <div id="memory-graph-stage" class="memory-graph-stage">
              <canvas id="memory-graph-canvas"></canvas>
              <div id="memory-graph-tooltip" class="memory-graph-tooltip" style="display:none"></div>
              <div id="memory-graph-empty" class="memory-graph-empty">Loading memory graph...</div>
              <div id="memory-drop-overlay" class="memory-drop-overlay" style="display:none">Drop image to reshape node outline</div>
            </div>
          </div>
          <aside id="memory-side-panel" class="memory-side-panel">
            <div class="memory-side-panel-header">
              <div class="memory-side-panel-title">Controls</div>
              <button class="memory-panel-collapse-btn" type="button" onclick="toggleMemoryControlsPanel()">&times;</button>
            </div>
            <section class="memory-panel-card memory-particle-controls">
              <div class="memory-panel-header-line">
                <div class="memory-panel-title">Controls</div>
                <div class="memory-panel-hint">live shaderless canvas</div>
              </div>
              <div class="memory-particle-modes">
                <button class="memory-particle-mode-btn active" type="button" data-memory-particle-mode="galaxy">Galaxy</button>
                <button class="memory-particle-mode-btn" type="button" data-memory-particle-mode="sphere">Sphere</button>
                <button class="memory-particle-mode-btn" type="button" data-memory-particle-mode="wave">Wave</button>
                <button class="memory-particle-mode-btn" type="button" data-memory-particle-mode="tunnel">Tunnel</button>
              </div>
              <div class="memory-control-stack">
                <label class="memory-control memory-control-row">
                  <span>Speed</span>
                  <input id="memory-particle-speed" type="range" min="0" max="200" step="1" value="35" />
                  <div id="memory-particle-speed-value" class="memory-control-value">35</div>
                </label>
                <label class="memory-control memory-control-row">
                  <span>Depth</span>
                  <input id="memory-particle-depth" type="range" min="160" max="900" step="10" value="740" />
                  <div id="memory-particle-depth-value" class="memory-control-value">740</div>
                </label>
                <label class="memory-control memory-control-row">
                  <span>Glow</span>
                  <input id="memory-particle-glow" type="range" min="0" max="100" step="1" value="20" />
                  <div id="memory-particle-glow-value" class="memory-control-value">20</div>
                </label>
              </div>
            </section>
            <section class="memory-panel-card">
              <div class="memory-panel-title">Filters</div>
              <div class="memory-control-stack">
                <label class="memory-control">
                  <span>Source Type</span>
                  <select id="memory-type-filter"><option value="">All records</option></select>
                </label>
                <label class="memory-control">
                  <span>Minimum edge weight</span>
                  <input id="memory-edge-weight" type="range" min="0" max="100" step="1" value="34" />
                  <div id="memory-edge-weight-value" class="memory-control-hint">0.34+</div>
                </label>
                <label class="memory-control memory-check">
                  <input id="memory-show-labels" type="checkbox" />
                  <span>Show labels for important nodes</span>
                </label>
                <label class="memory-control memory-check">
                  <input id="memory-organize-type" type="checkbox" />
                  <span>Organize by type</span>
                </label>
                <label class="memory-control memory-check memory-sub-check">
                  <input id="memory-separate-type" type="checkbox" />
                  <span>Separate</span>
                </label>
                <button id="memory-save-settings" class="memory-filter-save-btn" type="button">Save Settings</button>
              </div>
            </section>
          </aside>
          <button id="memory-controls-fab" class="memory-controls-fab" type="button" style="display:none" onclick="toggleMemoryControlsPanel()">Filters</button>
          <aside id="memory-detail-drawer" class="memory-detail-drawer" style="display:none">
            <div class="memory-detail-drawer-header">
              <div id="memory-drawer-title" class="memory-side-panel-title">Node Detail</div>
              <button class="memory-panel-collapse-btn" type="button" onclick="closeMemoryDetailDrawer()">&times;</button>
            </div>
            <div id="memory-detail-panel" class="memory-detail-panel">
              <div class="memory-detail-empty">Select a node to inspect its summary, source, and related records.</div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  `;
  wireHeaderActions(page, { onBack: () => navigate('#mobile/more') });
  page._pmCleanup = () => {
    memoryPageUnmount();
    restoreDesktopMemoryIds();
  };
  requestAnimationFrame(() => memoryPageActivate());
}

export async function renderMorePage(page, { section = '', navigate }) {
  if (section === 'hub') return _renderMoreHub(page, { navigate });
  if (section === 'audit') return _renderMoreAudit(page, { navigate });
  if (section === 'memory') return _renderMoreMemory(page, { navigate });
  return _renderMoreLanding(page, { navigate });
}

/* ---------------- PROPOSALS PAGE ---------------- */

export async function renderProposalsPage(page, { proposalId = '', navigate }) {
  if (proposalId) return _renderProposalReview(page, { proposalId, navigate });

  const extras = `<span class="pm-spacer"></span><select id="pm-proposals-filter" class="pm-select"><option value="pending">Pending</option><option value="executing">In progress</option><option value="approved">Approved</option><option value="denied">Denied</option><option value="executed">Executed</option><option value="all">All</option></select><button class="pm-icon-btn" id="pm-proposals-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Proposals', online: true, extras, hideTitle: true, hideBrand: true })}
    <div class="pm-body pm-proposals-page" id="pm-proposals-body">${_pmMoreSkeleton()}</div>
  `;
  wireHeaderActions(page, {});
  const body = page.querySelector('#pm-proposals-body');
  const filterEl = page.querySelector('#pm-proposals-filter');
  let proposals = [];
  let approvals = [];

  const paint = () => {
    const approvalHtml = approvals.length ? `<section class="pm-card pm-more-section">
      <div class="pm-card-head">Fast Approvals</div>
      ${approvals.map((approval) => {
        const human = _pmHumanApproval(approval);
        const technical = _pmApprovalTechnicalText(approval);
        const files = Array.isArray(approval?.devSourceEdit?.allowedFiles) ? approval.devSourceEdit.allowedFiles : [];
        const devPlan = approval?.devSourceEdit?.plan || null;
        const evidence = Array.isArray(devPlan?.evidence) ? devPlan.evidence : [];
        const steps = Array.isArray(devPlan?.steps) ? devPlan.steps : [];
        const expectedWorkflow = Array.isArray(devPlan?.expectedWorkflow)
          ? devPlan.expectedWorkflow
          : (Array.isArray(devPlan?.expected_workflow) ? devPlan.expected_workflow : []);
        return `<article class="pm-proposal-review-card" style="margin-top:10px">
          <div class="pm-proposal-head">
            <span class="pm-more-icon">${ICONS.clipboard}</span>
            <div>
              <strong>${escapeHtml(_pmApprovalTitle(approval))}</strong>
              <div class="pm-proposal-badges"><span class="pm-proposal-status pending">PENDING</span><span>risk ${escapeHtml(String(approval.riskScore ?? 0))}</span></div>
            </div>
          </div>
          <p>${escapeHtml(human.summary)}</p>
          ${human.detail ? `<div class="pm-approval-detail">${escapeHtml(human.detail)}</div>` : ''}
          ${devPlan?.reasoning ? `<div class="pm-approval-detail"><strong>Reasoning:</strong> ${escapeHtml(String(devPlan.reasoning))}</div>` : ''}
          ${devPlan?.currentState || devPlan?.fix ? `<div class="pm-approval-detail">${[
            devPlan.currentState ? `Current: ${String(devPlan.currentState)}` : '',
            devPlan.fix ? `Fix: ${String(devPlan.fix)}` : '',
          ].filter(Boolean).map(escapeHtml).join('<br>')}</div>` : ''}
          ${evidence.length ? `<details class="pm-approval-technical" open><summary>Evidence</summary><pre>${escapeHtml(evidence.slice(0, 5).map((item) => `${item.file || 'file'}${item.lines ? `:${item.lines}` : ''} - ${item.finding || ''}`).join('\n'))}</pre></details>` : ''}
          ${steps.length ? `<details class="pm-approval-technical"><summary>Plan</summary><pre>${escapeHtml(steps.slice(0, 8).map((step, idx) => `${idx + 1}. ${step}`).join('\n'))}</pre></details>` : ''}
          ${expectedWorkflow.length ? `<details class="pm-approval-technical" open><summary>Expected workflow after edits</summary><pre>${escapeHtml(expectedWorkflow.slice(0, 8).map((step, idx) => `${idx + 1}. ${step}`).join('\n'))}</pre></details>` : ''}
          ${files.length ? `<div class="pm-proposal-files">${files.slice(0, 4).map((file) => `<span>${escapeHtml(file)}</span>`).join('')}</div>` : ''}
          ${technical ? `<details class="pm-approval-technical"><summary>Technical details</summary><pre>${escapeHtml(technical)}</pre></details>` : ''}
          ${_pmRenderCommandRunLink(approval)}
          <div class="pm-proposal-actions">
            <button class="pm-btn success pm-proposal-action-btn" data-approve-approval="${escapeHtml(approval.id)}">Approve</button>
            <button class="pm-btn danger pm-proposal-action-btn" data-deny-approval="${escapeHtml(approval.id)}">Reject</button>
            ${_pmIsCommandApproval(approval) ? `<button class="pm-btn ghost pm-proposal-action-btn" data-approve-approval-session="${escapeHtml(approval.id)}">Trust session</button>
            <button class="pm-btn ghost pm-proposal-action-btn" data-approve-approval-always="${escapeHtml(approval.id)}">Always allow</button>` : ''}
          </div>
        </article>`;
      }).join('')}
    </section>` : '';
    const proposalHtml = proposals.length ? proposals.map((proposal) => {
      const isPending = String(proposal.status || '').toLowerCase() === 'pending';
      return `<article class="pm-card pm-proposal-card" data-proposal-id="${escapeHtml(proposal.id)}">
        <div class="pm-proposal-head">
          <span class="pm-more-icon">${ICONS.doc}</span>
          <div>
            <strong>${escapeHtml(proposal.title || 'Untitled proposal')}</strong>
            <div class="pm-proposal-badges">${_pmProposalPriority(proposal)}${_pmProposalStatus(proposal)}<span>${escapeHtml(proposal.type || 'proposal')}</span></div>
          </div>
          <button class="pm-icon-btn" data-open-proposal="${escapeHtml(proposal.id)}" aria-label="Open proposal">${ICONS.dots}</button>
        </div>
        <p>${escapeHtml(proposal.summary || '')}</p>
        ${_pmProposalFiles(proposal)}
        ${proposal.estimatedImpact ? `<p class="pm-proposal-impact">Impact: ${escapeHtml(proposal.estimatedImpact)}</p>` : ''}
        <div class="pm-more-meta-row"><span>Submitted: ${escapeHtml(_pmDateTime(proposal.createdAt))}</span><span>${escapeHtml(proposal.executorAgentId || 'main')}</span></div>
        <div class="pm-proposal-actions">
          ${isPending ? `<button class="pm-btn success pm-proposal-action-btn" data-approve-proposal="${escapeHtml(proposal.id)}">Approve</button><button class="pm-btn danger pm-proposal-action-btn" data-deny-proposal="${escapeHtml(proposal.id)}">Deny</button>` : ''}
          <button class="pm-btn ghost" data-open-proposal="${escapeHtml(proposal.id)}">View details & plan</button>
        </div>
      </article>`;
    }).join('') : '';
    body.innerHTML = approvalHtml || proposalHtml
      ? `${approvalHtml}${proposalHtml}`
      : `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.doc}</div><h2>No proposals here</h2><p>Agent-generated proposals and fast approvals will appear here when they need review.</p></div>`;
    wireProposalList();
  };

  const load = async () => {
    try {
      body.innerHTML = _pmMoreSkeleton();
      const status = filterEl?.value || 'pending';
      [proposals, approvals] = await Promise.all([
        loadMobileProposals(status),
        status === 'pending' || status === 'all' ? loadMobileApprovals('pending') : Promise.resolve([]),
      ]);
      paint();
    } catch (err) {
      body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.doc}</div><h2>Could not load proposals</h2><p>${escapeHtml(err.message || '')}</p></div>`;
    }
  };

  const act = async (id, kind, btn) => {
    if (!id) return;
    btn.disabled = true;
    try {
      const r = kind === 'approve' ? await approveMobileProposal(id) : await denyMobileProposal(id);
      if (!r || r.success === false) throw new Error(r?.error || `${kind} failed`);
      pmToast(kind === 'approve' ? 'Proposal approved' : 'Proposal denied', 'success');
      await load();
    } catch (err) {
      pmToast(err.message || 'Action failed', 'error');
    } finally {
      btn.disabled = false;
    }
  };

  const actApproval = async (id, kind, btn, grantScope = '') => {
    if (!id) return;
    btn.disabled = true;
    try {
      const r = kind === 'approve' ? await approveMobileApproval(id, grantScope) : await denyMobileApproval(id);
      if (!r || r.success === false) throw new Error(r?.error || `${kind} failed`);
      pmToast(kind === 'approve' ? (grantScope === 'always' ? 'Always allowed' : grantScope === 'session' ? 'Allowed this session' : 'Approved') : 'Rejected', 'success');
      await load();
      if (kind === 'approve') {
        const host = body.querySelector(`[data-process-approval-host="${_pmCssEscape(id)}"]`);
        if (host) _pmLoadApprovalProcessRun(id, host).then(() => _wireMobileProcessRunActions(host)).catch(() => {});
      }
    } catch (err) {
      pmToast(err.message || 'Action failed', 'error');
    } finally {
      btn.disabled = false;
    }
  };

  function wireProposalList() {
    body.querySelectorAll('[data-open-proposal]').forEach((btn) => btn.addEventListener('click', (event) => {
      event.stopPropagation();
      navigate(`#mobile/proposals/${encodeURIComponent(btn.getAttribute('data-open-proposal') || '')}`);
    }));
    body.querySelectorAll('[data-proposal-id]').forEach((card) => card.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      navigate(`#mobile/proposals/${encodeURIComponent(card.getAttribute('data-proposal-id') || '')}`);
    }));
    body.querySelectorAll('[data-approve-proposal]').forEach((btn) => btn.addEventListener('click', (event) => {
      event.stopPropagation();
      act(btn.getAttribute('data-approve-proposal'), 'approve', btn);
    }));
    body.querySelectorAll('[data-deny-proposal]').forEach((btn) => btn.addEventListener('click', (event) => {
      event.stopPropagation();
      act(btn.getAttribute('data-deny-proposal'), 'deny', btn);
    }));
    body.querySelectorAll('[data-approve-approval]').forEach((btn) => btn.addEventListener('click', (event) => {
      event.stopPropagation();
      actApproval(btn.getAttribute('data-approve-approval'), 'approve', btn);
    }));
    body.querySelectorAll('[data-approve-approval-session]').forEach((btn) => btn.addEventListener('click', (event) => {
      event.stopPropagation();
      actApproval(btn.getAttribute('data-approve-approval-session'), 'approve', btn, 'session');
    }));
    body.querySelectorAll('[data-approve-approval-always]').forEach((btn) => btn.addEventListener('click', (event) => {
      event.stopPropagation();
      actApproval(btn.getAttribute('data-approve-approval-always'), 'approve', btn, 'always');
    }));
    body.querySelectorAll('[data-deny-approval]').forEach((btn) => btn.addEventListener('click', (event) => {
      event.stopPropagation();
      actApproval(btn.getAttribute('data-deny-approval'), 'deny', btn);
    }));
    _wireMobileProcessRunActions(body);
  }

  filterEl?.addEventListener('change', load);
  page.querySelector('#pm-proposals-refresh')?.addEventListener('click', load);
  await load();
}

async function _renderProposalReview(page, { proposalId, navigate }) {
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Proposal Review', leftIcon: 'back', onBack: () => navigate('#mobile/proposals'), online: false, hideTitle: true, hideBrand: true })}
    <div class="pm-body pm-proposals-page" id="pm-proposal-review-body">${_pmMoreSkeleton()}</div>
  `;
  wireHeaderActions(page, { onBack: () => navigate('#mobile/proposals') });
  const body = page.querySelector('#pm-proposal-review-body');
  try {
    const r = await loadMobileProposal(proposalId);
    const proposal = r?.proposal || r;
    const isPending = String(proposal?.status || '').toLowerCase() === 'pending';
    body.innerHTML = `
      <section class="pm-card pm-proposal-review-card">
        <div class="pm-proposal-head">
          <span class="pm-more-icon">${ICONS.doc}</span>
          <div>
            <strong>${escapeHtml(proposal.title || 'Untitled proposal')}</strong>
            <div class="pm-proposal-badges">${_pmProposalPriority(proposal)}${_pmProposalStatus(proposal)}<span>${escapeHtml(proposal.type || 'proposal')}</span></div>
          </div>
        </div>
        <p>${escapeHtml(proposal.summary || '')}</p>
        ${_pmProposalFiles(proposal, 4)}
        ${proposal.estimatedImpact ? `<p class="pm-proposal-impact">Impact: ${escapeHtml(proposal.estimatedImpact)}</p>` : ''}
      </section>
      ${_pmProposalSteps(proposal)}
      ${proposal.details ? `<section class="pm-card pm-more-section"><div class="pm-card-head">Details</div><p style="white-space:pre-wrap;">${escapeHtml(proposal.details)}</p></section>` : ''}
      <div class="pm-proposal-review-actions">
        ${isPending ? `<button class="pm-btn success" id="pm-proposal-approve">Approve</button><button class="pm-btn danger" id="pm-proposal-deny">Deny</button>` : `<button class="pm-btn ghost" id="pm-proposal-back">Back to proposals</button>`}
      </div>
    `;
    body.querySelector('#pm-proposal-back')?.addEventListener('click', () => navigate('#mobile/proposals'));
    body.querySelector('#pm-proposal-approve')?.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      try {
        const res = await approveMobileProposal(proposal.id);
        if (!res || res.success === false) throw new Error(res?.error || 'Approve failed');
        pmToast('Proposal approved', 'success');
        navigate('#mobile/proposals');
      } catch (err) {
        pmToast(err.message || 'Approve failed', 'error');
        btn.disabled = false;
      }
    });
    body.querySelector('#pm-proposal-deny')?.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      try {
        const res = await denyMobileProposal(proposal.id);
        if (!res || res.success === false) throw new Error(res?.error || 'Deny failed');
        pmToast('Proposal denied', 'success');
        navigate('#mobile/proposals');
      } catch (err) {
        pmToast(err.message || 'Deny failed', 'error');
        btn.disabled = false;
      }
    });
  } catch (err) {
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.doc}</div><h2>Could not load proposal</h2><p>${escapeHtml(err.message || '')}</p></div>`;
  }
}

/* ---------------- TASKS PAGE ---------------- */

const TASK_PILL = {
  running:           { label: 'running',   cls: 'running' },
  queued:            { label: 'queued',    cls: 'orange' },
  paused:            { label: 'paused',    cls: 'gray' },
  stalled:           { label: 'stalled',   cls: 'orange' },
  needs_assistance:  { label: 'needs help',cls: 'orange' },
  awaiting_user_input:{ label: 'awaiting', cls: 'orange' },
  waiting_subagent:  { label: 'waiting',   cls: 'orange' },
  completed:         { label: 'complete',  cls: 'active' },
  succeeded:         { label: 'success',   cls: 'active' },
  failed:            { label: 'failed',    cls: 'orange' },
  cancelled:         { label: 'cancelled', cls: 'gray' },
};
const TASK_ACTIVE_STATUSES = new Set(['running','queued','paused','stalled','needs_assistance','awaiting_user_input','waiting_subagent']);

function _tasksSkeleton() {
  const block = `<div class="pm-card" style="opacity:.55"><div class="pm-card-head">${ICONS.clipboard} loading…</div><div class="pm-card-body" style="height:36px;background:rgba(0,0,0,.04);border-radius:6px;"></div></div>`;
  return block.repeat(3);
}

async function _renderTasksPageOld(page, { navigate }) {
  const extras = `<span class="pm-spacer"></span><span class="pm-count-pill" id="pm-tasks-count">…</span><button class="pm-icon-btn" id="pm-tasks-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Tasks', online: true, extras })}
    <div class="pm-body" id="pm-tasks-body">
      <div class="pm-tabs" id="pm-tasks-filter" style="margin-top:4px;">
        <button class="active" data-filter="active">Active</button>
        <button data-filter="all">All</button>
        <button data-filter="done">Done</button>
        <button data-filter="failed">Failed</button>
      </div>
      <div id="pm-tasks-list">${_tasksSkeleton()}</div>
    </div>
  `;
  wireHeaderActions(page, {});

  const listEl = page.querySelector('#pm-tasks-list');
  const countEl = page.querySelector('#pm-tasks-count');
  const filterEl = page.querySelector('#pm-tasks-filter');
  let allTasks = [];
  let currentFilter = 'active';

  function _paint() {
    let tasks = allTasks;
    if (currentFilter === 'active')      tasks = allTasks.filter(t => TASK_ACTIVE_STATUSES.has(String(t.status)));
    else if (currentFilter === 'done')   tasks = allTasks.filter(t => ['completed','succeeded'].includes(String(t.status)));
    else if (currentFilter === 'failed') tasks = allTasks.filter(t => ['failed','cancelled'].includes(String(t.status)));

    if (!tasks.length) {
      listEl.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clipboard}</div><h2>No tasks here</h2><p>Background tasks and agent runs will appear here.</p></div>`;
      return;
    }

    listEl.innerHTML = tasks.map(t => {
      const pill = TASK_PILL[String(t.status)] || { label: String(t.status || 'unknown'), cls: 'gray' };
      const started = t.startedAt || t.createdAt;
      const dur = t.finishedAt && t.startedAt ? _formatDuration(t.finishedAt - t.startedAt) : (t.startedAt ? _formatDuration(Date.now() - t.startedAt) : '');
      const summary = t.title || t.prompt || t.summary || t.detail || '';
      const progressItems = Array.isArray(t.runtimeProgress?.items) ? t.runtimeProgress.items : [];
      const currentStep = progressItems.find(it => String(it?.status) === 'in_progress')?.text || '';
      return `
        <article class="pm-card" style="padding:12px 14px;" data-task-id="${escapeHtml(String(t.id || ''))}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <strong style="flex:1;font-size:13px;line-height:1.3;">${escapeHtml(String(summary).slice(0, 140))}${String(summary).length > 140 ? '…' : ''}</strong>
            <span class="pm-pill ${pill.cls}">${pill.label}</span>
          </div>
          ${currentStep ? `<div class="pm-card-body" style="font-size:12px;color:var(--pm-text-soft);margin-bottom:4px;"><span style="color:var(--pm-orange);font-weight:700;">›</span> ${escapeHtml(currentStep.slice(0, 160))}</div>` : ''}
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--pm-muted);">
            <span>${escapeHtml(t.actor || t.source || 'task')} · ${progressItems.length} step${progressItems.length === 1 ? '' : 's'}</span>
            <span>${started ? _formatTimeAgo(started) : ''}${dur ? ' · ' + dur : ''}</span>
          </div>
        </article>
      `;
    }).join('');
  }

  filterEl.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      filterEl.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      currentFilter = b.getAttribute('data-filter');
      _paint();
    });
  });

  async function _load() {
    try {
      allTasks = await loadBgTasks();
      countEl.textContent = `${allTasks.length} task${allTasks.length === 1 ? '' : 's'}`;
      _paint();
    } catch (err) {
      listEl.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clipboard}</div><h2>Couldn’t load tasks</h2><p>${escapeHtml(err.message || '')}</p></div>`;
    }
  }
  page.querySelector('#pm-tasks-refresh').addEventListener('click', () => { listEl.innerHTML = _tasksSkeleton(); _load(); });
  await _load();
}

const PM_TASK_FILTERS = [
  { key: 'running', label: 'In Progress' },
  { key: 'complete', label: 'Completed' },
  { key: 'paused', label: 'Paused' },
  { key: 'needs_you', label: 'Needs You' },
  { key: 'failed', label: 'Failed' },
  { key: 'queued', label: 'Queued' },
];

function _pmTaskStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'completed' || s === 'done' || s === 'succeeded') return 'complete';
  if (s === 'awaiting_user_input') return 'needs_assistance';
  if (s === 'waiting_subagent' || s === 'in_progress') return 'running';
  if (s === 'cancelled') return 'failed';
  return s || 'queued';
}

function _pmTaskFilter(status) {
  const s = _pmTaskStatus(status);
  if (s === 'needs_assistance') return 'needs_you';
  if (s === 'stalled') return 'paused';
  if (['running', 'complete', 'paused', 'failed', 'queued'].includes(s)) return s;
  return 'queued';
}

function _pmTaskPill(status) {
  const normalized = _pmTaskStatus(status);
  return TASK_PILL[status] || TASK_PILL[normalized] || { label: normalized, cls: 'gray' };
}

function _pmTaskProgressItems(task) {
  const plan = Array.isArray(task?.plan) ? task.plan : [];
  if (plan.length) {
    const currentIndex = Number.isFinite(Number(task?.currentStepIndex)) ? Number(task.currentStepIndex) : -1;
    const taskStatus = String(task?.status || '').toLowerCase();
    return plan.map((step, idx) => {
      const raw = String(step?.status || 'pending').toLowerCase();
      let status = 'pending';
      if (raw === 'done' || raw === 'skipped') status = 'done';
      else if (raw === 'failed') status = 'failed';
      else if (raw === 'running' || (taskStatus === 'running' && idx === currentIndex)) status = 'in_progress';
      else if ((taskStatus === 'failed' || taskStatus === 'stalled' || taskStatus === 'needs_assistance') && idx === currentIndex) status = 'failed';
      return { text: step?.description || step?.text || step?.title || `Step ${idx + 1}`, status };
    });
  }
  const runtimeItems = Array.isArray(task?.runtimeProgress?.items) ? task.runtimeProgress.items : [];
  return runtimeItems.map((item, idx) => ({ text: item?.text || `Step ${idx + 1}`, status: item?.status || 'pending' }));
}

function _pmRenderTaskProgress(items) {
  if (!items.length) return `<div class="pm-card-body">No plan steps recorded yet.</div>`;
  return `<div style="display:flex;flex-direction:column;gap:8px;">${items.map((item, idx) => {
    const raw = String(item.status || 'pending').toLowerCase();
    const done = raw === 'done' || raw === 'skipped';
    const failed = raw === 'failed';
    const running = raw === 'running' || raw === 'in_progress';
    const color = failed ? '#d8473a' : done ? '#2fae66' : running ? '#0d4faf' : 'var(--pm-muted)';
    const mark = done ? 'OK' : failed ? '!' : String(idx + 1);
    return `<div style="display:grid;grid-template-columns:28px 1fr;gap:8px;align-items:start;">
      <span style="width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:${running ? '#eaf2ff' : done ? '#eaffe9' : failed ? '#fff0f0' : 'var(--pm-surface)'};border:1px solid var(--pm-border);color:${color};font-size:10px;font-weight:800;">${mark}</span>
      <span style="font-size:12px;line-height:1.45;color:var(--pm-text);">${escapeHtml(String(item.text || '').slice(0, 260))}</span>
    </div>`;
  }).join('')}</div>`;
}

function _pmRenderTaskJournal(journal) {
  const entries = Array.isArray(journal) ? journal.slice().reverse() : [];
  if (!entries.length) return `<div class="pm-card-body">No process log entries yet.</div>`;
  return `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;border:1px solid var(--pm-border);border-radius:8px;max-height:360px;overflow:auto;background:#fff;">${entries.map(entry => {
    const time = entry?.t ? _formatChatTime(entry.t) : '';
    const type = String(entry?.type || 'event');
    const content = String(entry?.content || entry?.detail || '').trim();
    const color = type === 'error' ? '#d8473a' : type === 'tool_call' ? '#0d4faf' : type === 'tool_result' ? '#2f7d44' : type === 'pause' ? '#7c4d00' : 'var(--pm-muted)';
    return `<div style="display:grid;grid-template-columns:54px 82px 1fr;gap:6px;padding:7px 8px;border-bottom:1px solid var(--pm-border);">
      <span style="color:var(--pm-muted);">${escapeHtml(time)}</span>
      <span style="color:${color};font-weight:800;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(type)}</span>
      <span style="white-space:pre-wrap;word-break:break-word;color:var(--pm-text-soft);">${escapeHtml(content)}</span>
    </div>`;
  }).join('')}</div>`;
}

function _pmRenderTaskRecovery(task) {
  const turns = Array.isArray(task?.recoveryConversation) ? task.recoveryConversation.slice(-12) : [];
  const pending = task?.pendingClarificationQuestion ? String(task.pendingClarificationQuestion) : '';
  const pauseMessage = task?.pauseAnalysis?.message || '';
  const bits = [];
  if (pending) bits.push(`<div class="pm-card-body"><strong>Pending question:</strong> ${escapeHtml(pending)}</div>`);
  if (pauseMessage) bits.push(`<div class="pm-card-body"><strong>Recovery plan:</strong><br>${escapeHtml(String(pauseMessage).slice(0, 1200))}</div>`);
  if (turns.length) {
    bits.push(`<div style="display:flex;flex-direction:column;gap:8px;">${turns.map(turn => {
      const isUser = turn?.role === 'user';
      return `<div style="align-self:${isUser ? 'flex-end' : 'flex-start'};max-width:92%;background:${isUser ? '#efe5ff' : 'var(--pm-surface)'};border:1px solid var(--pm-border);border-radius:8px;padding:8px 10px;">
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--pm-muted);margin-bottom:4px;">${escapeHtml(isUser ? 'You' : 'Prometheus')}</div>
        <div style="font-size:12px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(turn?.content || '')}</div>
      </div>`;
    }).join('')}</div>`);
  }
  return bits.join('') || `<div class="pm-card-body">No recovery messages yet.</div>`;
}

function _pmRenderTaskEvidence(entries) {
  if (!entries?.length) return `<div class="pm-card-body">No evidence bus entries yet.</div>`;
  return `<div style="display:flex;flex-direction:column;gap:8px;">${entries.slice().reverse().map(entry => `<div style="border:1px solid var(--pm-border);border-radius:8px;padding:8px 10px;background:#fff;">
    <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;">
      <strong style="font-size:12px;">${escapeHtml(entry?.title || entry?.type || 'Evidence')}</strong>
      <span style="font-size:10px;color:var(--pm-muted);">${entry?.t || entry?.timestamp ? escapeHtml(_formatChatTime(entry.t || entry.timestamp)) : ''}</span>
    </div>
    <div style="font-size:12px;color:var(--pm-text-soft);white-space:pre-wrap;word-break:break-word;">${escapeHtml(entry?.content || entry?.summary || entry?.text || JSON.stringify(entry).slice(0, 700))}</div>
  </div>`).join('')}</div>`;
}

function _pmTaskAction(task) {
  const s = String(task?.status || '').toLowerCase();
  if (s === 'running') return { action: 'pause', label: 'Pause' };
  if (['paused', 'queued', 'stalled', 'needs_assistance', 'awaiting_user_input'].includes(s)) return { action: 'resume', label: 'Resume' };
  if (s === 'failed') return { action: 'restart', label: 'Restart' };
  return null;
}

export async function renderTasksPage(page, { navigate }) {
  const extras = `<span class="pm-spacer"></span><span class="pm-count-pill" id="pm-tasks-count">...</span><button class="pm-icon-btn" id="pm-tasks-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Tasks', online: true, extras })}
    <div class="pm-body" id="pm-tasks-body">
      <div class="pm-tabs" id="pm-tasks-filter" style="margin-top:4px;overflow-x:auto;justify-content:flex-start;">
        ${PM_TASK_FILTERS.map((f, i) => `<button class="${i === 0 ? 'active' : ''}" data-filter="${f.key}">${escapeHtml(f.label)} <span data-count="${f.key}"></span></button>`).join('')}
      </div>
      <div id="pm-tasks-list">${_tasksSkeleton()}</div>
    </div>
  `;
  wireHeaderActions(page, {});

  const listEl = page.querySelector('#pm-tasks-list');
  const countEl = page.querySelector('#pm-tasks-count');
  const filterEl = page.querySelector('#pm-tasks-filter');
  let allTasks = [];
  let currentFilter = 'running';
  let expandedId = '';
  let details = {};
  let evidence = {};
  let refreshTimer = null;

  function paint() {
    const counts = PM_TASK_FILTERS.reduce((acc, f) => { acc[f.key] = 0; return acc; }, {});
    for (const t of allTasks) counts[_pmTaskFilter(t.status)] = (counts[_pmTaskFilter(t.status)] || 0) + 1;
    for (const f of PM_TASK_FILTERS) {
      const el = filterEl.querySelector(`[data-count="${f.key}"]`);
      if (el) el.textContent = counts[f.key] ? `(${counts[f.key]})` : '';
    }

    const tasks = allTasks.filter(t => _pmTaskFilter(t.status) === currentFilter);
    if (!tasks.length) {
      listEl.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clipboard}</div><h2>No tasks here</h2><p>Background tasks and agent runs will appear here.</p></div>`;
      return;
    }

    listEl.innerHTML = tasks.map(t => {
      const id = String(t.id || '');
      const pill = _pmTaskPill(String(t.status || ''));
      const started = t.startedAt || t.createdAt;
      const finishedAt = t.completedAt || t.finishedAt;
      const dur = finishedAt && t.startedAt ? _formatDuration(finishedAt - t.startedAt) : (t.startedAt ? _formatDuration(Date.now() - t.startedAt) : '');
      const summary = t.title || t.prompt || t.summary || t.detail || '';
      const progressItems = _pmTaskProgressItems(t);
      const currentStep = progressItems.find(it => String(it?.status) === 'in_progress')?.text || '';
      const isOpen = id === expandedId;
      const detail = details[id]?.task;
      const detailEvidence = evidence[id] || details[id]?.evidenceBus?.entries || [];
      const action = _pmTaskAction(detail || t);
      return `
        <article class="pm-card pm-task-card" style="padding:12px 14px;cursor:pointer;" data-task-id="${escapeHtml(id)}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <strong style="flex:1;font-size:13px;line-height:1.3;">${escapeHtml(String(summary).slice(0, 140))}${String(summary).length > 140 ? '...' : ''}</strong>
            <span class="pm-pill ${pill.cls}">${escapeHtml(pill.label)}</span>
          </div>
          ${currentStep ? `<div class="pm-card-body" style="font-size:12px;color:var(--pm-text-soft);margin-bottom:4px;"><span style="color:var(--pm-orange);font-weight:700;">&gt;</span> ${escapeHtml(String(currentStep).slice(0, 160))}</div>` : ''}
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--pm-muted);gap:10px;">
            <span>${escapeHtml(t.actor || t.source || 'task')} - ${progressItems.length} step${progressItems.length === 1 ? '' : 's'}</span>
            <span>${started ? _formatTimeAgo(started) : ''}${dur ? ' - ' + dur : ''}</span>
          </div>
          ${isOpen ? `<div class="pm-task-expanded" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--pm-border);display:flex;flex-direction:column;gap:12px;cursor:default;">
            ${!detail ? `<div class="pm-card-body">Loading task details...</div>` : `
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                ${action ? `<button class="pm-btn ghost" data-task-action="${action.action}" data-task-id="${escapeHtml(id)}">${escapeHtml(action.label)}</button>` : ''}
                ${['failed','complete'].includes(_pmTaskFilter(detail.status)) ? `<button class="pm-btn ghost danger" data-task-action="delete" data-task-id="${escapeHtml(id)}">${ICONS.trash} Remove</button>` : ''}
              </div>
              ${detail.finalSummary ? `<section><div class="pm-card-head">Final Response</div><div class="pm-card-body" style="white-space:pre-wrap;">${escapeHtml(detail.finalSummary)}</div></section>` : ''}
              ${['needs_assistance','awaiting_user_input','paused','stalled','failed'].includes(String(detail.status || '').toLowerCase()) ? `<section style="background:#f5eeff;border:1px solid #e0c8ff;border-radius:8px;padding:10px;">
                <div class="pm-card-head" style="color:#6d2d9e;">Needs You / Recovery</div>
                ${_pmRenderTaskRecovery(detail)}
                <div style="display:flex;gap:8px;margin-top:10px;">
                  <textarea class="pm-textarea" data-task-reply="${escapeHtml(id)}" rows="2" placeholder="Reply to this task..." style="min-height:58px;"></textarea>
                  <button class="pm-btn primary" data-task-send="${escapeHtml(id)}" style="align-self:flex-end;">Send</button>
                </div>
              </section>` : ''}
              <section><div class="pm-card-head">Progress</div>${_pmRenderTaskProgress(_pmTaskProgressItems(detail))}</section>
              <section><div class="pm-card-head">Task Prompt</div><div class="pm-card-body" style="white-space:pre-wrap;">${escapeHtml(detail.prompt || detail.title || '')}</div></section>
              <section><div class="pm-card-head">Evidence Bus</div>${_pmRenderTaskEvidence(detailEvidence)}</section>
              <section><div class="pm-card-head">Process Log</div>${_pmRenderTaskJournal(detail.journal)}</section>
            `}
          </div>` : ''}
        </article>
      `;
    }).join('');
    wireTaskCards();
  }

  function wireTaskCards() {
    listEl.querySelectorAll('.pm-task-card').forEach(card => {
      card.addEventListener('click', async (event) => {
        if (event.target.closest('button, textarea, input, a')) return;
        const id = card.getAttribute('data-task-id');
        expandedId = expandedId === id ? '' : id;
        paint();
        if (expandedId && !details[expandedId]) await loadDetail(expandedId);
      });
    });
    listEl.querySelectorAll('[data-task-action]').forEach(btn => {
      btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const id = btn.getAttribute('data-task-id');
        const actionName = btn.getAttribute('data-task-action');
        btn.disabled = true;
        try {
          const r = await runBgTaskAction(id, actionName);
          if (!r || r.success === false) throw new Error(r?.error || 'Action failed');
          pmToast(actionName === 'delete' ? 'Task removed' : 'Task updated', 'success');
          delete details[id];
          await load();
        } catch (err) {
          pmToast(err.message || 'Action failed', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });
    listEl.querySelectorAll('[data-task-send]').forEach(btn => {
      btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const id = btn.getAttribute('data-task-send');
        const input = listEl.querySelector(`[data-task-reply="${CSS.escape(id)}"]`);
        const message = String(input?.value || '').trim();
        if (!message) return;
        btn.disabled = true;
        try {
          const r = await sendBgTaskMessage(id, message);
          if (!r || r.success === false) throw new Error(r?.error || 'Send failed');
          if (input) input.value = '';
          pmToast('Reply sent', 'success');
          delete details[id];
          await loadDetail(id);
        } catch (err) {
          pmToast(err.message || 'Send failed', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  async function loadDetail(id) {
    try {
      const [detail, ev] = await Promise.all([loadBgTaskDetail(id), loadBgTaskEvidence(id)]);
      if (detail?.success && detail.task) details[id] = { task: detail.task, evidenceBus: detail.evidenceBus || null };
      evidence[id] = ev || [];
    } catch (err) {
      details[id] = { task: null, error: err?.message || 'Failed to load task detail' };
    }
    paint();
  }

  filterEl.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      filterEl.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      currentFilter = b.getAttribute('data-filter');
      expandedId = '';
      paint();
    });
  });

  async function load() {
    try {
      allTasks = await loadBgTasks();
      const activeCount = allTasks.filter(t => !['complete','failed'].includes(_pmTaskFilter(t.status))).length;
      countEl.textContent = `${activeCount} active`;
      paint();
      if (expandedId) {
        delete details[expandedId];
        await loadDetail(expandedId);
      }
    } catch (err) {
      listEl.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clipboard}</div><h2>Could not load tasks</h2><p>${escapeHtml(err.message || '')}</p></div>`;
    }
  }

  page.querySelector('#pm-tasks-refresh').addEventListener('click', () => { listEl.innerHTML = _tasksSkeleton(); load(); });
  await load();
  refreshTimer = setInterval(() => load().catch(() => {}), 5000);
  page._pmCleanup = () => { if (refreshTimer) clearInterval(refreshTimer); };
}

export function renderPlaceholderPage(page, { title, iconName = 'spark', subtitle, leftIcon = 'menu', onBack, navigate }) {
  page.innerHTML = `
    ${renderMobileHeader({ title, online: true, leftIcon, hideTitle: title === 'Creative' || title === 'Subagents' || title === 'Proposals' })}
    <div class="pm-body">
      <div class="pm-empty">
        <div class="pm-empty-icon">${ICONS[iconName] || ICONS.spark}</div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(subtitle || 'Coming soon to Prometheus Mobile.')}</p>
      </div>
    </div>
  `;
  wireHeaderActions(page, { onBack: onBack || (() => navigate && navigate('#mobile/chat')) });
}

/* ---------------- CREATIVE ---------------- */

const PM_CREATIVE_PROVIDERS = {
  image: [
    { id: 'xai',     label: 'xAI Image',     provider: 'xai',    model: '' },
    { id: 'openai',  label: 'OpenAI Image',  provider: 'openai', model: '' },
    { id: 'hf',      label: 'HyperFrames',   provider: 'hf',     model: '' },
  ],
  video: [
    { id: 'xai',     label: 'xAI Video',     provider: 'xai',    model: '' },
    { id: 'hf',      label: 'HyperFrames',   provider: 'hf',     model: '' },
  ],
};

const PM_CREATIVE_TEMPLATES = [
  { id: 'chibi',     title: 'Chibi',                 hint: 'Cute & stylized',     prompt: 'Adorable chibi-style character portrait, soft lighting, vivid colors, big expressive eyes, clean studio background, high-detail illustration.' },
  { id: 'headshot',  title: 'Professional Headshot', hint: 'Clean & polished',    prompt: 'Professional studio headshot, soft natural light, neutral background, sharp focus, photorealistic, business attire, confident expression.' },
  { id: 'bg-gen',    title: 'Background Generator',  hint: 'Scenic & textures',   prompt: 'Cinematic background plate with rich textures, depth, no characters, balanced composition for a product hero shot.' },
  { id: 'street70s', title: '70s Street Style',      hint: 'Vintage mood',        prompt: '1970s street fashion photograph, grainy film, warm tones, urban backdrop, golden hour, candid pose.' },
];

const PM_CREATIVE_MOTION_PRESETS = [
  { id: 'flythrough', title: 'Sci-Fi Flythrough', prompt: 'Slow cinematic flythrough across a futuristic floating city above the clouds, fighter jets escorting the camera, golden hour, 6 seconds, smooth motion.' },
  { id: 'neon',       title: 'Neon Streets',      prompt: 'Walking POV down neon-lit night streets, rain-slicked asphalt, blade-runner palette, slow handheld motion, 4 seconds.' },
  { id: 'sunrise',    title: 'Mountain Sunrise',  prompt: 'Time-lapse sunrise over a mountain lake reflecting pink and amber clouds, drifting mist, 5 seconds.' },
  { id: 'cozy',       title: 'Cozy Interior',     prompt: 'Slow dolly through a warm cozy living room, fireplace glow, soft sunbeams through window, vintage decor, 3 seconds.' },
];

const PM_CREATIVE_ASPECTS = {
  image: [
    { id: 'portrait',  label: '2:3',  ratio: 'portrait' },
    { id: 'square',    label: '1:1',  ratio: 'square' },
    { id: 'landscape', label: '3:2',  ratio: 'landscape' },
  ],
  video: [
    { id: 'landscape', label: '16:9', ratio: 'landscape' },
    { id: 'square',    label: '1:1',  ratio: 'square' },
    { id: 'portrait',  label: '9:16', ratio: 'portrait' },
  ],
};

function _creativeState() {
  if (!window.__pmCreative) {
    window.__pmCreative = {
      mode: 'image',
      provider: 'xai',
      aspect: 'portrait',
      agent: false,
      busy: false,
      currentResult: null, // { kind:'image'|'video', path:string, dataUrl?:string }
      gallery: { image: [], video: [] },
      sessionId: MOBILE_CHAT_SESSION_ID + '_creative',
      extract: { busy: false, requestId: '', stage: '', detail: '', stages: [] },
    };
  }
  return window.__pmCreative;
}

function _pmCreativeFmtName(name) {
  return String(name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').slice(0, 32);
}

export async function renderCreativePage(page, { navigate } = {}) {
  const state = _creativeState();
  const extras = `<button class="pm-icon-btn" id="pm-creative-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Prometheus', online: true, extras, hideTitle: false })}
    <div class="pm-body pm-creative" id="pm-creative-body">
      <h1 class="pm-creative-title">Creative Studio</h1>
      <div class="pm-creative-status"><span class="pm-creative-dot"></span> Online</div>

      <div class="pm-creative-modeswitch" id="pm-creative-mode">
        <button class="${state.mode === 'image' ? 'active' : ''}" data-mode="image">${ICONS.image} <span>Image</span></button>
        <button class="${state.mode === 'video' ? 'active' : ''}" data-mode="video">${ICONS.video} <span>Video</span></button>
      </div>

      <div class="pm-creative-providers" id="pm-creative-providers"></div>

      <div class="pm-creative-actions">
        <button class="pm-creative-action" data-action="upload">${ICONS.upload} <span>Upload</span></button>
        <button class="pm-creative-action accent" data-action="secondary">${ICONS.layers} <span data-secondary-label>Extract Layers</span></button>
        <button class="pm-creative-action" data-action="presets">${ICONS.preset} <span>Presets</span> ${ICONS.chev}</button>
      </div>

      <section id="pm-creative-image-stage" class="pm-creative-section" hidden>
        <div class="pm-creative-section-head">
          <h2>Featured Templates</h2>
          <button class="pm-creative-link" data-link="templates">View all</button>
        </div>
        <div class="pm-creative-templates" id="pm-creative-templates"></div>
      </section>

      <section id="pm-creative-video-stage" class="pm-creative-section" hidden>
        <div class="pm-creative-preview" id="pm-creative-video-preview">
          <div class="pm-creative-preview-empty">
            <div class="pm-empty-icon">${ICONS.video}</div>
            <p>Generated video will appear here.</p>
          </div>
        </div>
        <div class="pm-creative-chiprow" id="pm-creative-video-meta" hidden>
          <span class="pm-creative-chip">${ICONS.eye} <span data-meta-res>720p</span></span>
          <span class="pm-creative-chip">${ICONS.clock} <span data-meta-dur>—</span></span>
          <span class="pm-creative-chip ok"><span class="pm-creative-dot"></span> Timeline live</span>
        </div>
      </section>

      <section class="pm-creative-section">
        <div class="pm-creative-section-head">
          <h2 id="pm-creative-gallery-title">Discover</h2>
          <button class="pm-creative-link" data-link="gallery">View all</button>
        </div>
        <div class="pm-creative-gallery" id="pm-creative-gallery"></div>
      </section>

      <section id="pm-creative-video-bottom" class="pm-creative-section" hidden>
        <div class="pm-creative-quickrow">
          <button class="pm-creative-quick" data-quick="create-hf">
            <span class="pm-creative-quick-icon">${ICONS.spark}</span>
            <div>
              <strong>Create HyperFrame</strong>
              <small>Generate motion with deterministic frames.</small>
            </div>
            ${ICONS.chev}
          </button>
          <button class="pm-creative-quick" data-quick="motion-preset">
            <span class="pm-creative-quick-icon">${ICONS.layers}</span>
            <div>
              <strong>Motion preset</strong>
              <small id="pm-creative-motion-preset-label">Sci-Fi Flythrough · View & edit preset</small>
            </div>
            ${ICONS.chev}
          </button>
        </div>
      </section>

      <div class="pm-creative-composer" id="pm-creative-composer">
        <div class="pm-creative-composer-row">
          <button class="pm-icon-btn" data-composer="add" aria-label="Attach">${ICONS.plus}</button>
          <input type="text" class="pm-creative-input" id="pm-creative-prompt" placeholder="Type to imagine" autocomplete="off"/>
          <button class="pm-icon-btn" data-composer="voice" aria-label="Voice">${ICONS.micSmall}</button>
          <button class="pm-creative-send" id="pm-creative-send" aria-label="Generate">${ICONS.send}</button>
        </div>
        <div class="pm-creative-composer-meta">
          <button class="pm-creative-meta-chip" data-meta="agent"><span>${ICONS.robot}</span> Agent <small>${state.agent ? 'On' : 'Beta'}</small></button>
          <button class="pm-creative-meta-chip accent" data-meta="kind"><span data-kind-icon>${state.mode === 'video' ? ICONS.video : ICONS.image}</span> <span data-kind-label>${state.mode === 'video' ? 'Video' : 'Image'}</span></button>
          <button class="pm-creative-meta-chip" data-meta="aspect"><span>${ICONS.monitor}</span> <span data-aspect-label>${state.aspect}</span> ${ICONS.chev}</button>
          <button class="pm-creative-meta-chip" data-meta="outputs"><span>${ICONS.eye}</span> View outputs ${ICONS.chev}</button>
        </div>
      </div>
    </div>

    <div class="pm-creative-extract-modal" id="pm-creative-extract-modal" hidden>
      <div class="pm-creative-extract-card">
        <div class="pm-creative-extract-icon">${ICONS.layers}</div>
        <h3 id="pm-extract-stage">Extracting layers</h3>
        <p id="pm-extract-detail" class="pm-card-body">Preparing layer analysis...</p>
        <div class="pm-creative-extract-bar"><div id="pm-extract-fill"></div></div>
        <ul class="pm-creative-extract-stages" id="pm-extract-stages"></ul>
        <button class="pm-btn ghost" id="pm-extract-close">Hide</button>
      </div>
    </div>
  `;
  wireHeaderActions(page, {});

  const modeBar = page.querySelector('#pm-creative-mode');
  const providersBar = page.querySelector('#pm-creative-providers');
  const imageStage = page.querySelector('#pm-creative-image-stage');
  const videoStage = page.querySelector('#pm-creative-video-stage');
  const videoBottom = page.querySelector('#pm-creative-video-bottom');
  const templatesEl = page.querySelector('#pm-creative-templates');
  const galleryEl = page.querySelector('#pm-creative-gallery');
  const galleryTitle = page.querySelector('#pm-creative-gallery-title');
  const previewEl = page.querySelector('#pm-creative-video-preview');
  const promptInput = page.querySelector('#pm-creative-prompt');
  const sendBtn = page.querySelector('#pm-creative-send');

  function paintProviders() {
    providersBar.innerHTML = PM_CREATIVE_PROVIDERS[state.mode].map(p => `
      <button class="pm-creative-provider ${state.provider === p.id ? 'active' : ''}" data-provider="${escapeHtml(p.id)}">
        ${p.id === 'xai' ? '<span class="pm-creative-provider-mark xai">𝕏</span>'
          : p.id === 'openai' ? '<span class="pm-creative-provider-mark oai">◎</span>'
          : `<span class="pm-creative-provider-mark hf">${ICONS.hf}</span>`}
        <span>${escapeHtml(p.label)}</span>
      </button>
    `).join('');
    providersBar.querySelectorAll('[data-provider]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.provider = btn.getAttribute('data-provider');
        paintProviders();
      });
    });
  }

  function paintTemplates() {
    templatesEl.innerHTML = PM_CREATIVE_TEMPLATES.map(t => `
      <button class="pm-creative-template" data-template="${escapeHtml(t.id)}">
        <span class="pm-creative-template-thumb">${ICONS.image}</span>
        <strong>${escapeHtml(t.title)}</strong>
        <small>${escapeHtml(t.hint)}</small>
      </button>
    `).join('');
    templatesEl.querySelectorAll('[data-template]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tpl = PM_CREATIVE_TEMPLATES.find(t => t.id === btn.getAttribute('data-template'));
        if (tpl) { promptInput.value = tpl.prompt; promptInput.focus(); }
      });
    });
  }

  function paintGallery() {
    galleryTitle.textContent = state.mode === 'video' ? 'Recent renders' : 'Discover';
    const items = state.gallery[state.mode] || [];
    if (!items.length) {
      galleryEl.innerHTML = `<div class="pm-creative-gallery-empty">${ICONS[state.mode]} <span>No ${state.mode === 'video' ? 'renders' : 'images'} yet — generate one below.</span></div>`;
      return;
    }
    galleryEl.innerHTML = items.slice(0, 12).map(item => `
      <button class="pm-creative-gallery-card" data-gallery-path="${escapeHtml(item.relPath)}">
        ${state.mode === 'video'
          ? `<span class="pm-creative-thumb video">
              <video src="${escapeHtml(buildInlineMediaUrl(item.relPath))}#t=0.1" muted playsinline preload="metadata" crossorigin="use-credentials"></video>
              <span class="pm-creative-thumb-play">${ICONS.play}</span>
            </span>`
          : `<span class="pm-creative-thumb" data-thumb="${escapeHtml(item.relPath)}">${ICONS.image}</span>`}
        <strong>${escapeHtml(_pmCreativeFmtName(item.name))}</strong>
        <small>${escapeHtml(item.name.split('.').pop())} · ${_formatTimeAgo(item.mtime)}</small>
      </button>
    `).join('');
    // Lazy-load image thumbnails (videos render their first frame via #t=0.1).
    if (state.mode === 'image') {
      galleryEl.querySelectorAll('[data-thumb]').forEach(async (host) => {
        const rel = host.getAttribute('data-thumb');
        const url = await loadCanvasImageDataUrl(rel);
        if (url) host.innerHTML = `<img src="${url}" alt=""/>`;
      });
    }
    galleryEl.querySelectorAll('[data-gallery-path]').forEach(btn => {
      btn.addEventListener('click', () => openGalleryItem(btn.getAttribute('data-gallery-path')));
    });
  }

  async function openGalleryItem(relPath) {
    if (!relPath) return;
    if (state.mode === 'video') {
      await renderVideoPreview(relPath);
    } else {
      const url = await loadCanvasImageDataUrl(relPath);
      if (url) renderImagePreview(url, relPath);
    }
  }

  function renderImagePreview(dataUrl, relPath) {
    state.currentResult = { kind: 'image', path: relPath, dataUrl };
    // Show as a floating card at top of image stage.
    imageStage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    let card = page.querySelector('#pm-creative-image-current');
    if (!card) {
      card = document.createElement('div');
      card.id = 'pm-creative-image-current';
      card.className = 'pm-creative-current-image';
      imageStage.prepend(card);
    }
    card.innerHTML = `
      <div class="pm-creative-current-thumb"><img src="${dataUrl}" alt=""/></div>
      <div class="pm-creative-current-meta">
        <strong>${escapeHtml(_pmCreativeFmtName(relPath.split('/').pop()))}</strong>
        <small>${escapeHtml(relPath)}</small>
        <div class="pm-creative-current-actions">
          <button class="pm-btn primary" data-current-action="extract">${ICONS.layers} Extract Layers</button>
          <a class="pm-btn ghost" download href="${dataUrl}">${ICONS.download} Save</a>
        </div>
      </div>
    `;
    card.querySelector('[data-current-action="extract"]').addEventListener('click', () => runExtractLayers(relPath));
  }

  async function renderVideoPreview(relPath) {
    state.currentResult = { kind: 'video', path: relPath };
    const src = buildInlineMediaUrl(relPath);
    previewEl.innerHTML = `
      <video
        id="pm-creative-video-el"
        src="${escapeHtml(src)}"
        controls
        playsinline
        preload="metadata"
        crossorigin="use-credentials"
      ></video>
    `;
    const videoEl = previewEl.querySelector('#pm-creative-video-el');
    const metaRow = page.querySelector('#pm-creative-video-meta');
    if (metaRow) metaRow.hidden = false;
    if (videoEl) {
      videoEl.addEventListener('loadedmetadata', () => {
        const dur = Number.isFinite(videoEl.duration) ? Math.round(videoEl.duration) : 0;
        const w = videoEl.videoWidth || 0;
        const h = videoEl.videoHeight || 0;
        const resLabel = h >= 1080 ? '1080p' : h >= 720 ? '720p' : h >= 480 ? '480p' : (w && h ? `${w}x${h}` : '—');
        const durEl = page.querySelector('[data-meta-dur]');
        const resEl = page.querySelector('[data-meta-res]');
        if (durEl) durEl.textContent = dur ? `${dur}s` : '—';
        if (resEl) resEl.textContent = resLabel;
      }, { once: true });
      videoEl.addEventListener('error', () => {
        previewEl.innerHTML = `
          <div class="pm-creative-preview-stub">
            ${ICONS.video}
            <strong>${escapeHtml(_pmCreativeFmtName(relPath.split('/').pop()))}</strong>
            <small>${escapeHtml(relPath)}</small>
            <span class="pm-creative-preview-hint">Couldn't load this render. Tap Refresh and try again.</span>
          </div>
        `;
      });
    }
  }

  function paintMode() {
    const isImage = state.mode === 'image';
    imageStage.hidden = !isImage;
    videoStage.hidden = isImage;
    videoBottom.hidden = isImage;
    // Reset provider if current isn't valid for this mode.
    if (!PM_CREATIVE_PROVIDERS[state.mode].find(p => p.id === state.provider)) {
      state.provider = PM_CREATIVE_PROVIDERS[state.mode][0].id;
    }
    state.aspect = PM_CREATIVE_ASPECTS[state.mode][0].id;
    const kindLabel = page.querySelector('[data-kind-label]');
    const kindIcon = page.querySelector('[data-kind-icon]');
    if (kindLabel) kindLabel.textContent = isImage ? 'Image' : 'Video';
    if (kindIcon) kindIcon.innerHTML = isImage ? ICONS.image : ICONS.video;
    const aspectLabel = page.querySelector('[data-aspect-label]');
    if (aspectLabel) aspectLabel.textContent = PM_CREATIVE_ASPECTS[state.mode][0].label;
    const secondaryLabel = page.querySelector('[data-secondary-label]');
    if (secondaryLabel) secondaryLabel.textContent = isImage ? 'Extract Layers' : 'Export';
    paintProviders();
    paintTemplates();
    paintGallery();
    promptInput.placeholder = isImage ? 'Type to imagine' : 'Describe the motion you want...';
  }

  // ---- generation via chat ----

  function buildGenerationPrompt() {
    const text = String(promptInput.value || '').trim();
    if (!text) return '';
    const provider = state.provider;
    const aspect = PM_CREATIVE_ASPECTS[state.mode].find(a => a.id === state.aspect)?.ratio || 'square';
    if (state.mode === 'video') {
      if (provider === 'hf') {
        return `Use HyperFrames to compose and render a short motion video. Prompt: ${text}\nAspect: ${aspect}. After rendering, save the MP4 under generated/videos/ and tell me the final path.`;
      }
      return `Use the generate_video tool with provider="xai" to create a short video.\nPrompt: ${text}\nAspect ratio: ${aspect}. Duration: 6 seconds. Resolution: 720p. Save under generated/videos/. Reply with the final file path.`;
    }
    if (provider === 'hf') {
      return `Compose a HyperFrames still using web-based motion freeze-frame. Prompt: ${text}\nAspect: ${aspect}. Save the result PNG under generated/images/ and report the path.`;
    }
    return `Use the generate_image tool with provider="${provider}" to create an image.\nPrompt: ${text}\nAspect ratio: ${aspect}. Save under generated/images/. Reply with the final file path.`;
  }

  let activeStream = null;

  async function runGeneration() {
    if (state.busy) return;
    const prompt = buildGenerationPrompt();
    if (!prompt) { pmToast('Enter a prompt first', 'error'); promptInput.focus(); return; }
    state.busy = true;
    sendBtn.disabled = true;
    sendBtn.classList.add('busy');
    pmToast(state.mode === 'video' ? 'Generating video...' : 'Generating image...', 'info');
    let producedPath = '';
    activeStream = streamChat({ message: prompt, sessionId: state.sessionId }, {
      onToolResult: (evt) => {
        try {
          const name = String(evt?.name || evt?.tool || '');
          const extra = evt?.extra || evt?.toolResult?.extra || null;
          if (name === 'generate_image' && extra) {
            const path = extra.generated_image?.path || extra.generated_image || (Array.isArray(extra.generated_images) && extra.generated_images[0]?.path);
            if (path) producedPath = String(path);
          }
          if (name === 'generate_video' && extra) {
            const path = extra.generated_video?.path || extra.generated_video || (Array.isArray(extra.generated_videos) && extra.generated_videos[0]?.path);
            if (path) producedPath = String(path);
          }
        } catch {}
      },
      onError: (err) => {
        pmToast(err?.message || 'Generation failed', 'error');
      },
      onDone: async () => {
        state.busy = false;
        sendBtn.disabled = false;
        sendBtn.classList.remove('busy');
        activeStream = null;
        if (producedPath) {
          pmToast('Saved · refreshing gallery', 'success');
          if (state.mode === 'image') {
            const url = await loadCanvasImageDataUrl(producedPath);
            if (url) renderImagePreview(url, producedPath);
          } else {
            await renderVideoPreview(producedPath);
          }
        }
        await refreshGallery();
      },
    });
  }

  // ---- extract layers ----

  async function runExtractLayers(sourcePath) {
    if (!sourcePath) { pmToast('Pick or generate an image first', 'error'); return; }
    if (state.extract.busy) return;
    state.extract = { busy: true, requestId: 'mob_' + Date.now(), stage: 'Starting', detail: 'Submitting request', stages: [] };
    openExtractModal();
    try {
      const r = await creativeExtractLayers({
        sessionId: state.sessionId,
        source: sourcePath,
        mode: 'balanced',
        requestId: state.extract.requestId,
      });
      if (r?.success) {
        pmToast(`Extracted ${(r.layers || []).length} layers · scene saved`, 'success');
        const sceneRel = r.scenePath || '';
        if (sceneRel) {
          const stages = page.querySelector('#pm-extract-stages');
          if (stages) {
            const li = document.createElement('li');
            li.innerHTML = `<strong>Scene saved</strong> <small>${escapeHtml(sceneRel)}</small>`;
            stages.appendChild(li);
          }
        }
      } else {
        pmToast(r?.error || 'Extract failed', 'error');
      }
    } catch (err) {
      pmToast(err?.message || 'Extract failed', 'error');
    } finally {
      state.extract.busy = false;
      const closeBtn = page.querySelector('#pm-extract-close');
      if (closeBtn) closeBtn.textContent = 'Done';
    }
  }

  function openExtractModal() {
    const modal = page.querySelector('#pm-creative-extract-modal');
    modal.hidden = false;
    page.querySelector('#pm-extract-stage').textContent = 'Extracting layers';
    page.querySelector('#pm-extract-detail').textContent = 'Preparing layer analysis...';
    page.querySelector('#pm-extract-stages').innerHTML = '';
    page.querySelector('#pm-extract-fill').style.width = '4%';
    page.querySelector('#pm-extract-close').textContent = 'Hide';
  }

  function closeExtractModal() {
    const modal = page.querySelector('#pm-creative-extract-modal');
    if (modal) modal.hidden = true;
  }

  const PM_EXTRACT_STAGE_WEIGHTS = {
    source_loaded: 8, vision_candidates: 22, text_candidates: 32, proposal_merge: 38,
    foreground_start: 44, foreground_mask: 56, sam_start: 60, sam_masks: 74,
    alpha_cutouts: 78, vector_trace: 82, inpaint_start: 86, clean_plate: 94,
    scene_assembled: 100,
  };

  const onExtractProgress = (msg) => {
    if (!state.extract.busy) return;
    if (msg?.requestId && msg.requestId !== state.extract.requestId) return;
    const stage = String(msg.stage || 'progress');
    const label = String(msg.label || stage.replace(/_/g, ' '));
    const detail = String(msg.detail || '');
    page.querySelector('#pm-extract-stage').textContent = label;
    if (detail) page.querySelector('#pm-extract-detail').textContent = detail;
    const pct = PM_EXTRACT_STAGE_WEIGHTS[stage] || Math.min(95, (state.extract.stages.length + 1) * 10);
    page.querySelector('#pm-extract-fill').style.width = pct + '%';
    const stagesEl = page.querySelector('#pm-extract-stages');
    if (stagesEl) {
      state.extract.stages.push(stage);
      const li = document.createElement('li');
      li.innerHTML = `<span class="pm-creative-stage-dot"></span> <strong>${escapeHtml(label)}</strong>${detail ? ` <small>${escapeHtml(detail)}</small>` : ''}`;
      stagesEl.appendChild(li);
      stagesEl.scrollTop = stagesEl.scrollHeight;
    }
  };

  if (window.wsEventBus) {
    window.wsEventBus.on('creative_extract_layers_progress', onExtractProgress);
  }

  page.querySelector('#pm-extract-close').addEventListener('click', closeExtractModal);
  page.querySelector('#pm-creative-extract-modal').addEventListener('click', (e) => {
    if (e.target.id === 'pm-creative-extract-modal') closeExtractModal();
  });

  // ---- upload ----

  async function pickAndUploadImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = state.mode === 'video' ? 'video/*,image/*' : 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      pmToast('Uploading...', 'info');
      try {
        const buf = await file.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        const r = await uploadMobileBinaryFile({ filename: file.name, base64, mimeType: file.type });
        if (r?.success && r.path) {
          pmToast('Uploaded · ready to use', 'success');
          if (state.mode === 'image' && /\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
            const url = await loadCanvasImageDataUrl(r.path);
            if (url) renderImagePreview(url, r.path);
          }
        } else {
          pmToast(r?.error || 'Upload failed', 'error');
        }
      } catch (err) {
        pmToast(err?.message || 'Upload failed', 'error');
      }
    };
    input.click();
  }

  // ---- aspect picker ----

  function openAspectPicker() {
    const opts = PM_CREATIVE_ASPECTS[state.mode];
    const overlay = document.createElement('div');
    overlay.className = 'pm-creative-sheet-overlay';
    overlay.innerHTML = `
      <div class="pm-creative-sheet">
        <h3>Aspect ratio</h3>
        <div class="pm-creative-sheet-options">
          ${opts.map(o => `<button data-aspect="${escapeHtml(o.id)}" class="${state.aspect === o.id ? 'active' : ''}">${escapeHtml(o.label)}<small>${escapeHtml(o.ratio)}</small></button>`).join('')}
        </div>
        <button class="pm-btn ghost" data-close="1">Cancel</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.getAttribute('data-close')) overlay.remove();
      const a = e.target.closest('[data-aspect]');
      if (a) {
        state.aspect = a.getAttribute('data-aspect');
        const aspectLabel = page.querySelector('[data-aspect-label]');
        const opt = opts.find(o => o.id === state.aspect);
        if (aspectLabel && opt) aspectLabel.textContent = opt.label;
        overlay.remove();
      }
    });
  }

  function openPresetsSheet() {
    const list = state.mode === 'video' ? PM_CREATIVE_MOTION_PRESETS : PM_CREATIVE_TEMPLATES;
    const overlay = document.createElement('div');
    overlay.className = 'pm-creative-sheet-overlay';
    overlay.innerHTML = `
      <div class="pm-creative-sheet">
        <h3>${state.mode === 'video' ? 'Motion presets' : 'Image presets'}</h3>
        <div class="pm-creative-sheet-list">
          ${list.map(p => `<button data-preset="${escapeHtml(p.id)}"><strong>${escapeHtml(p.title)}</strong><small>${escapeHtml(p.hint || p.prompt.slice(0, 80))}</small></button>`).join('')}
        </div>
        <button class="pm-btn ghost" data-close="1">Close</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.getAttribute('data-close')) overlay.remove();
      const p = e.target.closest('[data-preset]');
      if (p) {
        const item = list.find(i => i.id === p.getAttribute('data-preset'));
        if (item) { promptInput.value = item.prompt; promptInput.focus(); }
        overlay.remove();
      }
    });
  }

  // ---- gallery refresh ----

  async function refreshGallery() {
    const [images, videos] = await Promise.all([
      loadCreativeGallery({ kind: 'image' }),
      loadCreativeGallery({ kind: 'video' }),
    ]);
    state.gallery.image = images;
    state.gallery.video = videos;
    paintGallery();
  }

  // ---- wire all interactions ----

  modeBar.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mode = btn.getAttribute('data-mode');
      modeBar.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b === btn));
      paintMode();
    });
  });

  page.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      if (action === 'upload') return pickAndUploadImage();
      if (action === 'presets') return openPresetsSheet();
      if (action === 'secondary') {
        if (state.mode === 'image') {
          const path = state.currentResult?.path || (state.gallery.image[0]?.relPath || '');
          if (!path) { pmToast('Generate or upload an image first', 'error'); return; }
          return runExtractLayers(path);
        }
        // video: export
        const path = state.currentResult?.path || (state.gallery.video[0]?.relPath || '');
        if (!path) { pmToast('Generate a video first', 'error'); return; }
        window.open(buildInlineMediaUrl(path), '_blank');
      }
    });
  });

  page.querySelectorAll('[data-meta]').forEach(btn => {
    btn.addEventListener('click', () => {
      const meta = btn.getAttribute('data-meta');
      if (meta === 'aspect') return openAspectPicker();
      if (meta === 'kind') {
        state.mode = state.mode === 'image' ? 'video' : 'image';
        modeBar.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.getAttribute('data-mode') === state.mode));
        paintMode();
      }
      if (meta === 'agent') {
        state.agent = !state.agent;
        btn.querySelector('small').textContent = state.agent ? 'On' : 'Beta';
      }
      if (meta === 'outputs') {
        document.getElementById('pm-creative-gallery')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  page.querySelectorAll('[data-quick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.getAttribute('data-quick');
      if (q === 'create-hf') {
        state.mode = 'video';
        state.provider = 'hf';
        modeBar.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.getAttribute('data-mode') === 'video'));
        paintMode();
        promptInput.focus();
      }
      if (q === 'motion-preset') openPresetsSheet();
    });
  });

  page.querySelectorAll('[data-composer]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.getAttribute('data-composer');
      if (k === 'add') pickAndUploadImage();
      if (k === 'voice') navigate?.('#mobile/voice');
    });
  });

  page.querySelectorAll('[data-link]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.getAttribute('data-link');
      if (k === 'templates') openPresetsSheet();
      if (k === 'gallery') document.getElementById('pm-creative-gallery')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  sendBtn.addEventListener('click', runGeneration);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runGeneration(); }
  });
  page.querySelector('#pm-creative-refresh').addEventListener('click', refreshGallery);

  paintMode();
  await refreshGallery();

  // Cleanup: unbind WS handler when navigating away.
  page._pmCleanup = () => {
    try { window.wsEventBus?.off('creative_extract_layers_progress', onExtractProgress); } catch {}
    try { activeStream?.abort?.(); } catch {}
  };
}

/* ---------------- SUBAGENTS ---------------- */

// Avatar palette + hash match desktop SubagentsPage so the same agent gets the
// same robot + color across desktop and mobile.
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

// Procedurally-generated cute robot. Ported from drawAgentSVG in
// web-ui/src/pages/SubagentsPage.js so desktop and mobile show the same robot.
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

const SUBAGENT_STATUS_PILL = {
  running:   { label: 'running',   cls: 'running' },
  idle:      { label: 'idle',      cls: 'gray' },
  scheduled: { label: 'scheduled', cls: 'orange' },
  team:      { label: 'team',      cls: 'active' },
  failed:    { label: 'failed',    cls: 'orange' },
};

function _subagentTileHtml(a) {
  const pill = SUBAGENT_STATUS_PILL[a.status] || SUBAGENT_STATUS_PILL.idle;
  return `
    <button class="pm-team-tile pm-subagent-tile" data-subagent="${escapeHtml(a.id)}" type="button">
      <span class="pm-subagent-robot">${_drawAgentSVG(a.id, { scale: 0.5 })}</span>
      <span class="pm-team-tile-meta">
        <strong>${escapeHtml(a.name)}</strong>
        <small>${a.model ? escapeHtml(a.model) : 'default model'}</small>
      </span>
      <span class="pm-pill ${pill.cls}">${pill.label}</span>
    </button>
  `;
}

function subagentsSkeletonHtml() {
  return `
    <div class="pm-team-grid">
      ${Array.from({ length: 4 }).map(() => `
        <div class="pm-team-tile" style="opacity:.5;">
          <span class="pm-avatar" style="background:var(--pm-bg-soft);">…</span>
          <span class="pm-team-tile-meta"><strong style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;">loading</strong><small style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;">model</small></span>
        </div>
      `).join('')}
    </div>
  `;
}

export async function renderSubagentsPage(page, { navigate } = {}) {
  const extras = `
    <span class="pm-count-pill" id="pm-subagents-count">…</span>
    <span class="pm-spacer"></span>
    <button class="pm-icon-btn" id="pm-subagents-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>
  `;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Subagents', online: false, extras })}
    <div class="pm-body" id="pm-subagents-body">${subagentsSkeletonHtml()}</div>
  `;
  wireHeaderActions(page, {});

  const body = page.querySelector('#pm-subagents-body');
  const countEl = page.querySelector('#pm-subagents-count');

  async function paint() {
    let agents = [];
    try {
      agents = await loadMobileSubagents();
    } catch (err) {
      body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.robot}</div><h2>Couldn’t load subagents</h2><p>${escapeHtml(err.message || 'Network error')}</p></div>`;
      countEl.textContent = '0 agents';
      return;
    }
    countEl.textContent = `${agents.length} agent${agents.length === 1 ? '' : 's'}`;
    if (!agents.length) {
      body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.robot}</div><h2>No subagents yet</h2><p>Create agents from the desktop Settings → Agents page.</p></div>`;
      return;
    }
    const featured = agents[0];
    const previewHtml = `
      <div class="pm-team-preview">
        <div class="pm-team-preview-head">
          <span class="pm-subagent-robot pm-subagent-robot-sm">${_drawAgentSVG(featured.id, { scale: 0.45 })}</span>
          <h3>${escapeHtml(featured.name)}</h3>
          <button class="pm-pill-btn" data-go="${escapeHtml(featured.id)}">Open ${ICONS.chev}</button>
        </div>
        <div style="font-size:13px;color:var(--pm-muted);font-weight:700;margin-top:4px;">${escapeHtml(featured.model || 'Default model')}${featured.isTeamMember ? ' · team member' : ''}</div>
        ${featured.description ? `<div class="pm-card-body" style="margin-top:6px;">${escapeHtml(featured.description.slice(0, 240))}${featured.description.length > 240 ? '…' : ''}</div>` : ''}
        <div class="pm-divider"></div>
        <div class="pm-row"><span>${ICONS.wand} Tools</span><span style="color:var(--pm-muted)">${featured.tools.length ? featured.tools.length + ' allowed' : 'all'}</span></div>
        <div class="pm-divider"></div>
        <div class="pm-row"><span>${ICONS.clock} Last run</span><span style="color:var(--pm-muted)">${escapeHtml(_formatTimeAgo(featured.lastRunAt || 0))}</span></div>
      </div>
    `;
    body.innerHTML = `
      <div class="pm-team-grid">${agents.map(_subagentTileHtml).join('')}</div>
      ${previewHtml}
    `;
    body.querySelectorAll('[data-subagent]').forEach(btn => {
      btn.addEventListener('click', () => navigate?.(`#mobile/subagents/${btn.getAttribute('data-subagent')}`));
    });
    body.querySelectorAll('[data-go]').forEach(btn => {
      btn.addEventListener('click', () => navigate?.(`#mobile/subagents/${btn.getAttribute('data-go')}`));
    });
  }

  page.querySelector('#pm-subagents-refresh').addEventListener('click', () => {
    body.innerHTML = subagentsSkeletonHtml();
    paint();
  });
  await paint();
}

/* ---------------- SUBAGENT DETAIL ---------------- */

function subagentDetailSkeleton() {
  return `
    <div class="pm-detail-head"><span class="pm-subagent-robot pm-subagent-robot-lg" style="opacity:.4;">${_drawAgentSVG('loading', { scale: 0.7 })}</span><h1 style="background:rgba(0,0,0,.06);color:transparent;border-radius:8px;height:24px;flex:1;">loading</h1></div>
    <div class="pm-detail-sub">…</div>
    <div class="pm-action-row">
      <button class="pm-action-btn primary">${ICONS.send} Dispatch</button>
      <button class="pm-action-btn">${ICONS.refresh} Heartbeat</button>
    </div>
    <div class="pm-card" style="opacity:.5"><div class="pm-card-head">${ICONS.robot} Overview</div><div class="pm-card-body">Loading agent…</div></div>
  `;
}

export async function renderSubagentDetailPage(page, { agentId, navigate, initialTab = '' }) {
  page.innerHTML = `
    <header class="pm-header">
      <button class="pm-icon-btn" data-action="back" aria-label="Back">${ICONS.back}</button>
      <div class="pm-brand">${FLAME}<span>Prometheus</span></div>
      <button class="pm-icon-btn" data-action="settings" aria-label="Settings">${ICONS.gear}</button>
    </header>
    <div class="pm-body" id="pm-detail-body">${subagentDetailSkeleton()}</div>
  `;
  wireHeaderActions(page, { onBack: () => navigate?.('#mobile/subagents') });

  const body = page.querySelector('#pm-detail-body');

  let agent = null;
  try {
    agent = await loadMobileSubagentDetail(agentId);
  } catch (err) {
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.robot}</div><h2>Couldn’t load subagent</h2><p>${escapeHtml(err.message || 'Network error')}</p></div>`;
    return;
  }
  if (!agent) {
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.robot}</div><h2>Subagent not found</h2><p>${escapeHtml(agentId)} isn’t available right now.</p></div>`;
    return;
  }

  const pill = SUBAGENT_STATUS_PILL[agent.status] || SUBAGENT_STATUS_PILL.idle;
  const tabs = ['Overview', 'Chat', 'System Prompt', 'Runs', 'Heartbeat'];

  body.innerHTML = `
    <div class="pm-detail-head">
      <span class="pm-subagent-robot pm-subagent-robot-lg">${_drawAgentSVG(agent.id, { isActive: true, scale: 0.7 })}</span>
      <h1>${escapeHtml(agent.name)}</h1>
      <span class="pm-pill ${pill.cls}" style="align-self:center;">${pill.label}</span>
    </div>
    <div class="pm-detail-sub">${escapeHtml(agent.model || 'Default model')}${agent.isTeamMember ? ' · team member' : ''}${agent.cronSchedule ? ' · scheduled' : ''}</div>

    <div class="pm-action-row">
      <button class="pm-action-btn primary" data-act="dispatch">${ICONS.send} Dispatch Task</button>
      <button class="pm-action-btn"          data-act="heartbeat">${ICONS.refresh} Tick</button>
      <button class="pm-action-btn"          data-act="open-chat">${ICONS.chat} Chat</button>
    </div>

    <div class="pm-tabs" role="tablist">
      ${tabs.map((tab, i) => `<button class="${i === 0 ? 'active' : ''}" data-tab="${tab}">${escapeHtml(tab)}</button>`).join('')}
    </div>

    <div id="pm-tab-slot"></div>

    <div id="pm-overview-slot">
      <div class="pm-card">
        <div class="pm-card-head">${ICONS.target} Description</div>
        <div class="pm-card-body">${escapeHtml(agent.description || 'No description set.')}</div>
      </div>

      <div class="pm-card-grid">
        <div class="pm-card">
          <div class="pm-card-head">${ICONS.brain} Model</div>
          <div class="pm-card-body strong">${escapeHtml(agent.model || 'default')}</div>
        </div>
        <div class="pm-card">
          <div class="pm-card-head">${ICONS.clock} Last Run</div>
          <div class="pm-card-body strong">${escapeHtml(_formatTimeAgo(agent.lastRunAt || 0))}</div>
        </div>
        <div class="pm-card">
          <div class="pm-card-head">${ICONS.wand} Allowed Tools</div>
          <div class="pm-card-body">${agent.tools.length ? agent.tools.slice(0, 8).map(t => `<span class="pm-tool-chip">${escapeHtml(String(t))}</span>`).join(' ') + (agent.tools.length > 8 ? `<span class="pm-tool-chip more">+${agent.tools.length - 8}</span>` : '') : '<em style="color:var(--pm-muted);">All tools</em>'}</div>
        </div>
        <div class="pm-card">
          <div class="pm-card-head">${ICONS.globe} MCP Servers</div>
          <div class="pm-card-body">${agent.mcpServers.length ? agent.mcpServers.map(s => `<span class="pm-tool-chip">${escapeHtml(String(s))}</span>`).join(' ') : '<em style="color:var(--pm-muted);">None</em>'}</div>
        </div>
      </div>

      <div class="pm-card" id="pm-subagent-ctxrefs">
        <div class="pm-card-head">${ICONS.doc} Context References</div>
        <div class="pm-card-body" id="pm-subagent-ctxrefs-body">Loading…</div>
      </div>
    </div>
  `;

  // Lazy-load context refs into overview.
  (async () => {
    try {
      const refs = await loadSubagentContextRefs(agentId);
      const host = body.querySelector('#pm-subagent-ctxrefs-body');
      if (!host) return;
      if (!refs.length) {
        host.innerHTML = '<em style="color:var(--pm-muted);">No context references attached.</em>';
        return;
      }
      host.innerHTML = refs.slice(0, 10).map(r => `
        <div class="pm-ctxref">
          <strong>${escapeHtml(r.title || r.id || 'Reference')}</strong>
          <span>${escapeHtml(String(r.body || r.content || r.preview || '').slice(0, 140))}${String(r.body || r.content || r.preview || '').length > 140 ? '…' : ''}</span>
        </div>
      `).join('');
    } catch {}
  })();

  const overviewSlot = body.querySelector('#pm-overview-slot');
  const tabSlot = body.querySelector('#pm-tab-slot');

  let currentStream = null;

  async function selectTab(tabName) {
    try { tabSlot?._pmCleanup?.(); } catch {}
    if (tabSlot) tabSlot._pmCleanup = null;
    body.querySelectorAll('.pm-tabs button').forEach(x => x.classList.toggle('active', x.getAttribute('data-tab') === tabName));
    if (tabName === 'Overview') {
      overviewSlot.style.display = '';
      tabSlot.innerHTML = '';
      return;
    }
    overviewSlot.style.display = 'none';
    tabSlot.innerHTML = `<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading ${escapeHtml(tabName)}…</div>`;
    try {
      if (tabName === 'Chat')              await _renderSubagentChatTab(tabSlot, agent, (s) => { currentStream = s; });
      else if (tabName === 'System Prompt') await _renderSubagentSystemPromptTab(tabSlot, agentId);
      else if (tabName === 'Runs')          await _renderSubagentRunsTab(tabSlot, agentId);
      else if (tabName === 'Heartbeat')     await _renderSubagentHeartbeatTab(tabSlot, agentId);
    } catch (err) {
      tabSlot.innerHTML = `<div class="pm-card"><div class="pm-card-head">${ICONS.robot} Error</div><div class="pm-card-body">${escapeHtml(err.message || 'Failed to load')}</div></div>`;
    }
  }

  body.querySelectorAll('.pm-tabs button').forEach(b => {
    b.addEventListener('click', () => selectTab(b.getAttribute('data-tab')));
  });
  const initialTabName = tabs.find(tab => tab.toLowerCase().replace(/\s+/g, '-') === String(initialTab || '').toLowerCase());
  if (initialTabName && initialTabName !== 'Overview') selectTab(initialTabName);

  // Action buttons.
  async function _action(btn, fn, doneMsg) {
    const prev = btn.innerHTML;
    btn.disabled = true;
    btn.style.opacity = '0.6';
    try {
      const r = await fn();
      if (r && r.success === false) throw new Error(r?.error || 'Failed');
      if (doneMsg) pmToast(doneMsg, 'success');
      return r;
    } catch (err) {
      pmToast(err.message || 'Action failed', 'error');
      throw err;
    } finally {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.innerHTML = prev;
    }
  }

  body.querySelectorAll('[data-act]').forEach(btn => {
    const act = btn.getAttribute('data-act');
    btn.addEventListener('click', async () => {
      if (act === 'dispatch') openDispatchSheet(agentId, btn);
      else if (act === 'heartbeat') {
        await _action(btn, () => tickSubagentHeartbeat(agentId), 'Heartbeat ticked').catch(() => {});
      }
      else if (act === 'open-chat') selectTab('Chat');
    });
  });

  page._pmCleanup = () => {
    try { tabSlot?._pmCleanup?.(); } catch {}
    try { currentStream?.abort?.(); } catch {}
  };
}

function openDispatchSheet(agentId, anchorBtn) {
  const overlay = document.createElement('div');
  overlay.className = 'pm-creative-sheet-overlay';
  overlay.innerHTML = `
    <div class="pm-creative-sheet">
      <h3>Dispatch a task</h3>
      <p style="color:var(--pm-muted);font-size:13px;margin:-6px 0 12px;text-align:center;">Sent to <strong>${escapeHtml(agentId)}</strong> as a one-shot task.</p>
      <textarea class="pm-textarea" id="pm-dispatch-task" rows="4" placeholder="Describe the task for this subagent…" style="min-height:120px;"></textarea>
      <div class="pm-row-buttons" style="margin-top:10px;">
        <button class="pm-btn ghost" data-close="1">Cancel</button>
        <button class="pm-btn primary" id="pm-dispatch-submit">${ICONS.send} Dispatch</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.getAttribute('data-close')) close();
  });
  overlay.querySelector('#pm-dispatch-submit').addEventListener('click', async () => {
    const task = String(overlay.querySelector('#pm-dispatch-task').value || '').trim();
    if (!task) { pmToast('Describe the task first', 'error'); return; }
    const submit = overlay.querySelector('#pm-dispatch-submit');
    submit.disabled = true;
    submit.innerHTML = '…sending';
    try {
      const r = await spawnSubagentTask(agentId, task);
      if (r?.success) {
        const preview = String(r.result?.result || r.result?.summary || '').slice(0, 140);
        pmToast(preview ? `Done · ${preview}` : 'Task complete', 'success');
        close();
      } else {
        pmToast(r?.error || 'Dispatch failed', 'error');
        submit.disabled = false;
        submit.innerHTML = `${ICONS.send} Dispatch`;
      }
    } catch (err) {
      pmToast(err.message || 'Dispatch failed', 'error');
      submit.disabled = false;
      submit.innerHTML = `${ICONS.send} Dispatch`;
    }
  });
  setTimeout(() => overlay.querySelector('#pm-dispatch-task')?.focus(), 50);
}

async function _renderSubagentSystemPromptTab(slot, agentId) {
  const md = await loadSubagentSystemPrompt(agentId);
  if (!md) {
    slot.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.doc}</div><h2>No system prompt set</h2><p>Edit this agent from the desktop Settings → Agents page.</p></div>`;
    return;
  }
  slot.innerHTML = `
    <div class="pm-card" style="padding:0;overflow:hidden;">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--pm-border);">
        <span>${ICONS.doc} System Prompt</span>
        <button class="pm-btn ghost" id="pm-sp-copy" style="padding:4px 10px;font-size:12px;">${ICONS.check} Copy</button>
      </div>
      <pre class="pm-subagent-md">${escapeHtml(md)}</pre>
    </div>
  `;
  slot.querySelector('#pm-sp-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(md); pmToast('Copied to clipboard', 'success'); }
    catch { pmToast('Could not copy', 'error'); }
  });
}

async function _renderSubagentRunsTab(slot, agentId) {
  const runs = await loadSubagentRuns(agentId, 30);
  if (!runs.length) {
    slot.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clock}</div><h2>No runs yet</h2><p>Tap Dispatch Task above to give this agent something to do.</p></div>`;
    return;
  }
  slot.innerHTML = runs.map(r => {
    const ok = r.success === true || r.status === 'complete';
    const pill = r.inProgress
      ? '<span class="pm-pill running">running</span>'
      : ok
        ? '<span class="pm-pill active">success</span>'
        : `<span class="pm-pill orange">${escapeHtml(String(r.taskStatus || r.status || 'failed'))}</span>`;
    const summary = String(r.taskSummary || r.summary || r.prompt || '').slice(0, 220);
    const started = r.startedAt || r.createdAt;
    const finished = r.finishedAt || r.completedAt;
    const duration = (finished && started) ? _formatDuration(finished - started) : '';
    return `
      <article class="pm-card" style="padding:14px 16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <strong style="flex:1;font-size:14px;">${escapeHtml(r.taskName || r.title || 'Task')}</strong>
          ${pill}
        </div>
        ${summary ? `<div class="pm-card-body" style="margin-bottom:6px;">${escapeHtml(summary)}${summary.length >= 220 ? '…' : ''}</div>` : ''}
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--pm-muted);">
          <span>${escapeHtml(r.trigger || 'manual')} · ${r.stepCount || r.steps || 0} steps</span>
          <span>${_formatTimeAgo(started)}${duration ? ' · ' + duration : ''}</span>
        </div>
      </article>
    `;
  }).join('');
}

async function _renderSubagentHeartbeatTab(slot, agentId) {
  slot.innerHTML = `<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading heartbeat…</div>`;
  const { status, markdown } = await loadSubagentHeartbeat(agentId);
  const lastTick = status?.lastTickAt || status?.last_tick_at || status?.timestamp;
  slot.innerHTML = `
    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>${ICONS.clock} Last tick</span>
        <button class="pm-btn primary" id="pm-hb-tick" style="padding:6px 12px;font-size:12px;">${ICONS.refresh} Tick now</button>
      </div>
      <div class="pm-card-body strong">${lastTick ? escapeHtml(_formatTimeAgo(lastTick)) : '<em style="color:var(--pm-muted);">No heartbeat yet</em>'}</div>
    </div>
    ${markdown ? `
      <div class="pm-card" style="padding:0;overflow:hidden;">
        <div class="pm-card-head" style="padding:12px 14px;border-bottom:1px solid var(--pm-border);">${ICONS.doc} Heartbeat Notes</div>
        <pre class="pm-subagent-md">${escapeHtml(markdown)}</pre>
      </div>
    ` : `<div class="pm-empty" style="padding:24px;"><div class="pm-empty-icon">${ICONS.spark}</div><p>No heartbeat notes yet. Tick to refresh.</p></div>`}
  `;
  const btn = slot.querySelector('#pm-hb-tick');
  if (btn) {
    btn.addEventListener('click', async () => {
      const prev = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '…ticking';
      try {
        const r = await tickSubagentHeartbeat(agentId);
        if (r?.success === false) throw new Error(r?.error || 'Failed');
        pmToast('Heartbeat ticked', 'success');
        await _renderSubagentHeartbeatTab(slot, agentId);
      } catch (err) {
        pmToast(err.message || 'Tick failed', 'error');
        btn.disabled = false;
        btn.innerHTML = prev;
      }
    });
  }
}

async function _renderSubagentChatTab(slot, agent, attachStream) {
  slot.innerHTML = `
    <div class="pm-card" id="pm-sa-chat-card" style="padding:0;overflow:hidden;">
      <div id="pm-sa-chat-list" style="max-height:55vh;overflow-y:auto;padding:14px 14px 8px;"></div>
      <div id="pm-sa-chat-queue" class="pm-mobile-queued-prompts" hidden></div>
      ${_renderMobileAgentComposerHtml('pm-sa-chat', `Message ${agent.name || 'this subagent'}...`)}
    </div>
  `;

  const listEl = slot.querySelector('#pm-sa-chat-list');
  const queueEl = slot.querySelector('#pm-sa-chat-queue');

  let messages = [];
  let liveMsg = null;
  let currentStream = null;
  let lastSeq = 0;
  let lastStreamId = '';
  let localSseActive = false;
  let cleanupDone = false;
  const sendQueue = [];
  let approvalCards = [];
  let composer = null;

  const isBusy = () => !!(currentStream || liveMsg?.streaming || localSseActive);
  const approvalBelongsHere = (approvalInput = {}) => {
    const approval = _normalizeMobileApproval(approvalInput);
    const sid = String(approval.sessionId || approval.sourceSessionId || '').trim();
    return !!approval.id && (
      sid === `subagent_chat_${agent.id}`
      || String(approval.agentId || '').trim() === String(agent.id)
    );
  };
  const upsertApprovalCard = (approvalInput = {}) => {
    if (!approvalBelongsHere(approvalInput)) return false;
    const approval = _normalizeMobileApproval(approvalInput);
    const idx = approvalCards.findIndex((item) => String(item?.approvalRequest?.id || '') === approval.id);
    const msg = {
      role: 'agent',
      content: '',
      createdAt: Date.now(),
      approvalRequest: approval,
    };
    if (idx >= 0) approvalCards[idx] = { ...approvalCards[idx], approvalRequest: { ...(approvalCards[idx].approvalRequest || {}), ...approval } };
    else approvalCards.push(msg);
    approvalCards = approvalCards.slice(-8);
    return true;
  };
  const updateApprovalCard = (id, status, event = {}) => {
    const approvalId = String(id || '').trim();
    if (!approvalId) return false;
    const idx = approvalCards.findIndex((item) => String(item?.approvalRequest?.id || '') === approvalId);
    if (idx < 0) return false;
    approvalCards[idx].approvalRequest = _normalizeMobileApproval({ ...(approvalCards[idx].approvalRequest || {}), ...(event.approval || event), id: approvalId, status });
    return true;
  };
  const restoreApprovalCards = async () => {
    const pending = await loadMobileApprovals('pending').catch(() => []);
    (Array.isArray(pending) ? pending : []).forEach(upsertApprovalCard);
  };

  function renderQueue() {
    if (!queueEl) return;
    queueEl.hidden = sendQueue.length === 0;
    queueEl.innerHTML = sendQueue.length
      ? `<div class="pm-mobile-queued-head"><span>Queued messages</span><b>${sendQueue.length}</b></div>
         <div class="pm-mobile-queued-list">${sendQueue.map((item, idx) => `
           <div class="pm-mobile-queued-item">
             <button type="button" class="pm-mobile-queued-text" data-sa-queue-edit="${idx}">${escapeHtml(String(item.text || 'Attached file(s)').slice(0, 120))}${item.files?.length ? ` <em>+${item.files.length}</em>` : ''}</button>
             <div class="pm-mobile-queued-actions"><button type="button" class="pm-mobile-queued-icon pm-mobile-queued-remove" data-sa-queue-remove="${idx}" aria-label="Remove queued message">${ICONS.trash}</button></div>
           </div>`).join('')}</div>`
      : '';
    queueEl.querySelectorAll('[data-sa-queue-remove]').forEach((btn) => btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-sa-queue-remove'));
      if (Number.isFinite(idx)) sendQueue.splice(idx, 1);
      renderQueue();
    }));
  }

  function drainQueueSoon() {
    if (isBusy() || !sendQueue.length) {
      composer?.update?.();
      return;
    }
    const next = sendQueue.shift();
    renderQueue();
    startSubagentMobileSend(next).catch((err) => pmToast(err?.message || 'Send failed', 'error'));
  }

  function upsertServerMessages(fresh) {
    const localLive = liveMsg && !liveMsg._done ? liveMsg : null;
    messages = Array.isArray(fresh) ? fresh.slice() : [];
    if (localLive) {
      const duplicate = messages.some((m) =>
        String(m.content || m.text || '').trim()
        && String(m.content || m.text || '').trim() === String(localLive.content || '').trim()
      );
      if (!duplicate) messages.push(localLive);
    }
  }

  function renderList() {
    const visibleApprovals = approvalCards.filter((m) => String(m?.approvalRequest?.status || 'pending') === 'pending');
    const rendered = [...messages, ...visibleApprovals];
    if (!rendered.length) {
      listEl.innerHTML = `<div style="text-align:center;color:var(--pm-muted);padding:24px 8px;font-size:13px;">No messages yet. Send the first one to ${escapeHtml(agent.name)}.</div>`;
      return;
    }
    listEl.innerHTML = rendered.map((m) => _renderMobileAgentChatBubble(m, {
      sender: agent.name || agent.id || 'Subagent',
      live: m === liveMsg,
    })).join('');
    listEl.querySelectorAll('[data-pm-approval-action][data-pm-approval-id]').forEach((btn) => {
      btn.addEventListener('click', () => _resolveMobileApprovalButton(btn));
    });
    _wireMobileProcessRunActions(listEl);
    listEl.scrollTop = listEl.scrollHeight;
  }

  try {
    upsertServerMessages(await loadSubagentChat(agent.id, 80));
    await restoreApprovalCards();
    renderList();
  } catch (err) {
    listEl.innerHTML = `<div style="color:var(--pm-red);padding:16px;">${escapeHtml(err.message || 'Failed to load chat')}</div>`;
  }

  async function reconcile({ forceHistory = false } = {}) {
    try {
      const replay = await loadSubagentChatStreamReplay(agent.id, lastStreamId ? lastSeq : 0);
      if (replay.stream?.streamId && replay.stream.streamId !== lastStreamId) {
        lastStreamId = replay.stream.streamId;
        lastSeq = 0;
      }
      if (replay.stream?.streamId && !liveMsg && replay.active) {
        liveMsg = { role: 'agent', content: '', _progress: 'Reconnecting...', createdAt: Date.now(), workStartedAt: Date.now(), streaming: true, processEntries: [] };
        messages.push(liveMsg);
      }
      for (const frame of replay.events || []) {
        if (frame.streamId) lastStreamId = frame.streamId;
        lastSeq = Math.max(lastSeq, Number(frame.seq || 0));
        if (!liveMsg) {
          liveMsg = { role: 'agent', content: '', _progress: 'Reconnecting...', createdAt: Date.now(), workStartedAt: Date.now(), streaming: true, processEntries: [] };
          messages.push(liveMsg);
        }
        _applyMobileAgentStreamEvent(liveMsg, _mobileReplayFrameToEvent(frame), agent.name || agent.id || 'Subagent');
      }
      if (forceHistory || !replay.active || liveMsg?._done) {
        upsertServerMessages(await loadSubagentChat(agent.id, 80));
        await restoreApprovalCards();
        if (!replay.active) liveMsg = null;
      }
      renderList();
    } catch {}
  }

  const onWsOpen = () => reconcile({ forceHistory: true });
  const onVisibility = () => { if (!document.hidden) reconcile({ forceHistory: true }); };
  const onSubagentChatMessage = async (msg = {}) => {
    if (String(msg.agentId || '') !== String(agent.id)) return;
    try {
      upsertServerMessages(await loadSubagentChat(agent.id, 80));
      liveMsg = null;
      renderList();
    } catch {}
  };
  const onSubagentStreamEvent = (msg = {}) => {
    if (String(msg.agentId || '') !== String(agent.id)) return;
    if (localSseActive) return;
    if (msg.streamId && msg.streamId !== lastStreamId) {
      lastStreamId = msg.streamId;
      lastSeq = 0;
    }
    lastSeq = Math.max(lastSeq, Number(msg.seq || 0));
    if (!liveMsg) {
      liveMsg = { role: 'agent', content: '', _progress: `${agent.name} is thinking...`, createdAt: Date.now(), workStartedAt: Date.now(), streaming: true, processEntries: [] };
      messages.push(liveMsg);
    }
    _applyMobileAgentStreamEvent(liveMsg, { type: String(msg.event || ''), ...(msg.data || {}) }, agent.name || agent.id || 'Subagent');
    renderList();
  };
  const onApprovalCreated = async (msg = {}) => {
    const approval = msg.approval ? _normalizeMobileApproval(msg.approval, msg) : await _approvalFromMobileEvent(msg);
    if (upsertApprovalCard(approval)) renderList();
  };
  const onApprovalResolved = (eventName) => (msg = {}) => {
    const status = eventName === 'approval_approved' ? 'approved'
      : eventName === 'approval_denied' ? 'rejected'
        : eventName === 'approval_expired' ? 'expired'
          : 'failed';
    if (updateApprovalCard(msg.approvalId || msg.id || msg.approval?.id, status, msg)) renderList();
  };
  const onApprovalApproved = onApprovalResolved('approval_approved');
  const onApprovalDenied = onApprovalResolved('approval_denied');
  const onApprovalExpired = onApprovalResolved('approval_expired');
  const onApprovalFailed = onApprovalResolved('approval_failed');
  wsEventBus?.on?.('ws:open', onWsOpen);
  wsEventBus?.on?.('subagent_chat_message', onSubagentChatMessage);
  wsEventBus?.on?.('subagent_chat_stream_event', onSubagentStreamEvent);
  wsEventBus?.on?.('approval_created', onApprovalCreated);
  wsEventBus?.on?.('approval_approved', onApprovalApproved);
  wsEventBus?.on?.('approval_denied', onApprovalDenied);
  wsEventBus?.on?.('approval_expired', onApprovalExpired);
  wsEventBus?.on?.('approval_failed', onApprovalFailed);
  document.addEventListener('visibilitychange', onVisibility);
  slot._pmCleanup = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    try { currentStream?.abort?.(); } catch {}
    wsEventBus?.off?.('ws:open', onWsOpen);
    wsEventBus?.off?.('subagent_chat_message', onSubagentChatMessage);
    wsEventBus?.off?.('subagent_chat_stream_event', onSubagentStreamEvent);
    wsEventBus?.off?.('approval_created', onApprovalCreated);
    wsEventBus?.off?.('approval_approved', onApprovalApproved);
    wsEventBus?.off?.('approval_denied', onApprovalDenied);
    wsEventBus?.off?.('approval_expired', onApprovalExpired);
    wsEventBus?.off?.('approval_failed', onApprovalFailed);
    document.removeEventListener('visibilitychange', onVisibility);
  };
  reconcile();

  async function startSubagentMobileSend(payload) {
    const rawText = String(payload?.text || '').trim();
    const files = Array.isArray(payload?.files) ? payload.files : [];
    const userVisibleText = rawText || (files.length ? 'Please review the attached file(s).' : '');
    if (!userVisibleText && !files.length) return;
    if (isBusy()) {
      sendQueue.push({ text: rawText, files });
      renderQueue();
      composer?.update?.();
      return;
    }
    let messageForRuntime = userVisibleText;
    let attachmentPreviews = files;
    if (files.length) {
      const uploadResults = await _uploadMobileChatAttachments(files);
      messageForRuntime = `${userVisibleText}${_buildMobileFileContextNote(uploadResults)}`;
      attachmentPreviews = uploadResults.map((r, idx) => ({
        ...(files[idx] || {}),
        name: r.name || files[idx]?.name || 'attachment',
        kind: r.isImage ? 'image' : (r.isVideo ? 'video' : (files[idx]?.kind || 'file')),
        workspacePath: r.workspacePath || files[idx]?.workspacePath,
        path: r.workspacePath || files[idx]?.path,
        dataUrl: files[idx]?.dataUrl,
        mimeType: files[idx]?.mimeType,
        sizeLabel: files[idx]?.sizeLabel,
      }));
    }

    const userMsg = { role: 'user', content: messageForRuntime, body: { text: messageForRuntime, attachments: attachmentPreviews }, attachmentPreviews, createdAt: Date.now() };
    messages.push(userMsg);
    liveMsg = { role: 'agent', content: '', _progress: `${agent.name} is thinking...`, createdAt: Date.now(), workStartedAt: Date.now(), streaming: true, processEntries: [] };
    messages.push(liveMsg);
    renderList();

    localSseActive = true;
    composer?.update?.();
    currentStream = streamSubagentChat(agent.id, { message: messageForRuntime }, {
      onEvent: (evt) => {
        _applyMobileAgentStreamEvent(liveMsg, evt, agent.name || agent.id || 'Subagent');
        renderList();
      },
      onError: (err) => {
        if (err?.name === 'AbortError') return;
        liveMsg.content = liveMsg.content || `Error: ${err?.message || 'stream failed'}`;
        liveMsg._progress = '';
        liveMsg.streaming = false;
        liveMsg.workEndedAt = Date.now();
        localSseActive = false;
        currentStream = null;
        composer?.update?.();
        renderList();
      },
      onDone: async () => {
        if (liveMsg) {
          liveMsg._progress = '';
          liveMsg.streaming = false;
          liveMsg.workEndedAt = liveMsg.workEndedAt || Date.now();
          liveMsg.workDurationMs = Math.max(0, liveMsg.workEndedAt - Number(liveMsg.workStartedAt || liveMsg.createdAt || liveMsg.workEndedAt));
        }
        localSseActive = false;
        currentStream = null;
        composer?.update?.();
        await reconcile({ forceHistory: true });
        drainQueueSoon();
      },
    });
    attachStream?.(currentStream);
  }

  composer = _installMobileAgentComposer(slot, 'pm-sa-chat', {
    placeholder: `Message ${agent.name || 'this subagent'}...`,
    isBusy,
    onAbort: () => {
      try { currentStream?.abort?.(); } catch {}
      if (liveMsg) {
        liveMsg._progress = 'Stopping...';
        liveMsg.streaming = false;
      }
      currentStream = null;
      localSseActive = false;
      renderList();
    },
    onSubmit: startSubagentMobileSend,
  });
  renderQueue();
}
