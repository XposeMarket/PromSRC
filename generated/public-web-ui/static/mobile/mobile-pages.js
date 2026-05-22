// Mobile pages — render functions for every mobile route.
import {
  chatMessages, recentCommands, mobileSchedules, mobileTeams, mobileTeamDetail,
} from './mobile-data.js';
import {
  ICONS, icon, escapeHtml, el, renderMobileHeader, wireHeaderActions, openDrawer,
} from './mobile-shell.js';
import { memoryPageActivate, memoryPageUnmount } from '../pages/MemoryPage.js';
import {
  loadMobileSchedules, toggleSchedule, runScheduleNow,
  loadMobileTeams, loadMobileTeamDetail,
  startTeamRun, pauseTeam, resumeTeam, triggerTeamReview, deleteTeam,
  saveTeamContextReference, invalidateTeamsCache,
  streamChat, MOBILE_CHAT_SESSION_ID, createMobileChatSessionId, createMobileChatSession,
  loadGatewayStatus, loadLatestUsableSession, loadMobileChatSession, loadMobileChatRunStatus, loadMobileChatRunStatuses, loadMobileChatStreamReplay,
  updateMobileChatSessionHistory, markMobileEditRerunReset, markMobileChatSessionRead,
  loadTeamRuns, loadTeamChat, postTeamChat, loadTeamRoomState,
  claimPairing, pollPairing, verifyPairingMe,
  createVoiceInterruptionEvent,
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
  spawnSubagentTask, streamSubagentChat,
} from './mobile-api.js';
import { checkSessionDetailed, getAccount, mountLoginScreen } from '../auth/account.js';
import { renderMd } from '../utils.js';
import { wsEventBus } from '../ws.js';

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

/* ---------------- CHAT ---------------- */

// Persistent in-tab thread. Survives navigation between mobile pages.
const PM_MOBILE_ACTIVE_RUN_KEY = 'pm_mobile_active_chat_run';
const PM_MOBILE_ACTIVE_RUNS_KEY = 'pm_mobile_active_chat_runs';

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
  __pmChat.activeSessionId = MOBILE_CHAT_SESSION_ID;
  __pmChat.threads[MOBILE_CHAT_SESSION_ID] = [];
  __pmChat.attachments[MOBILE_CHAT_SESSION_ID] = [];
  __pmChat.editingMessageIndex = -1;
  navigate?.('#mobile/chat');
  return MOBILE_CHAT_SESSION_ID;
}

function _startMobileNewVoiceDraft() {
  __pmChat.activeSessionId = MOBILE_CHAT_SESSION_ID;
  __pmChat.threads[MOBILE_CHAT_SESSION_ID] = [];
  __pmChat.attachments[MOBILE_CHAT_SESSION_ID] = [];
  __pmChat.editingMessageIndex = -1;
  __pmVoice.targetSessionId = MOBILE_CHAT_SESSION_ID;
  __pmVoice.targetSessionLabel = 'Mobile - New Chat';
  __pmVoice.targetSessionChannel = 'mobile';
  __pmVoice.targetSessionForced = true;
  return MOBILE_CHAT_SESSION_ID;
}

function _serverRoleToMobileRole(role) {
  return String(role || '').toLowerCase() === 'user' ? 'user' : 'ai';
}

function _mobileRoleToServerRole(role) {
  return String(role || '').toLowerCase() === 'user' ? 'user' : 'assistant';
}

function _mapServerMessageToMobile(m, index = -1) {
  const role = _serverRoleToMobileRole(m?.role);
  const content = String(m?.content || '');
  const attachmentPreviews = Array.isArray(m?.attachmentPreviews) ? m.attachmentPreviews : [];
  return {
    role,
    sourceIndex: Number.isFinite(Number(index)) ? Number(index) : -1,
    timestamp: Number(m?.timestamp || Date.now()) || Date.now(),
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
  delete clone._editingDraft;
  return clone;
}

function _mobileMessageCopyText(msg) {
  return String(msg?.content || msg?.body?.text || '').trim();
}

function _mobileHistoryForServer(thread = _activeMobileThread()) {
  return (Array.isArray(thread) ? thread : [])
    .filter((msg) => msg && (msg.role === 'user' || msg.role === 'ai'))
    .filter((msg) => !msg.streaming)
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
          <span>${escapeHtml(String(item.message || 'Attached file(s)').slice(0, 140))}${Array.isArray(item.files) && item.files.length ? ` <em>+${item.files.length} file${item.files.length === 1 ? '' : 's'}</em>` : ''}</span>
          <button type="button" data-remove-mobile-queued="${index}" aria-label="Remove queued prompt">Remove</button>
        </div>
      `).join('')}
    </div>`;
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

function _renderMobileProcess(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return '';
  const recent = list.slice(-5);
  const full = list.map((entry) => `
    <div class="pm-process-row ${escapeHtml(entry.type)}">
      <span>${escapeHtml(entry.type)}</span>
      <p>${escapeHtml(entry.text)}</p>
    </div>
  `).join('');
  return `
    <details class="pm-process-stream"${list.length <= 2 ? ' open' : ''}>
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
  if (!Array.isArray(message.liveTraceEntries)) message.liveTraceEntries = [];
  const normalizedType = String(type || 'info').toLowerCase();
  const last = message.liveTraceEntries[message.liveTraceEntries.length - 1];
  if (append && last && last.type === normalizedType) {
    last.text = `${last.text || ''}${content}`;
  } else {
    const trimmed = content.trim();
    if (!trimmed) return;
    if (last && last.type === normalizedType && String(last.text || '').trim() === trimmed) return;
    message.liveTraceEntries.push({ type: normalizedType, text: trimmed });
    if (message.liveTraceEntries.length > 24) message.liveTraceEntries = message.liveTraceEntries.slice(-24);
  }
}

function _renderMobileLiveTrace(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter((entry) => String(entry?.text || '').trim()).slice(-18);
  if (!list.length) return '';
  return `<div class="pm-live-trace">${list.map((entry) => {
    const type = String(entry.type || 'info').toLowerCase();
    const label = type === 'assistant' ? 'Prometheus' : type === 'think' ? 'Reasoning' : type === 'result' ? 'Tool result' : type === 'error' ? 'Tool error' : 'Tool';
    const text = String(entry.text || '').trim();
    const body = type === 'assistant'
      ? `<div class="pm-live-md">${_renderMobileMarkdown(text)}</div>`
      : `<div class="pm-live-text">${escapeHtml(text)}</div>`;
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

function _mergeMobileThreadLocalArtifacts(nextThread, localThread) {
  const next = Array.isArray(nextThread) ? nextThread : [];
  const local = Array.isArray(localThread) ? localThread : [];
  if (!next.length || !local.length) return next;
  next.forEach((msg, index) => {
    if (!msg || msg.role !== 'ai') return;
    const localSameSlot = local[index]?.role === 'ai' ? local[index] : null;
    const localBySource = local.find((candidate) => (
      candidate?.role === 'ai'
      && Number.isFinite(Number(candidate.sourceIndex))
      && Number(candidate.sourceIndex) === Number(msg.sourceIndex)
    ));
    const localCandidate = localSameSlot || localBySource;
    if (localCandidate) _mergeMobileMediaIntoMessage(msg, _collectMessageMedia(localCandidate));
  });
  const localLatest = _findLatestAssistantTurn(local);
  const nextLatest = _findLatestAssistantTurn(next);
  if (localLatest && nextLatest) _mergeMobileMediaIntoMessage(nextLatest, _collectMessageMedia(localLatest));
  return next;
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
    devSourceEdit: source.devSourceEdit || fallback.devSourceEdit || null,
    finalAction: source.finalAction || fallback.finalAction || null,
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
    if (approved) await approveMobileApproval(id, grantScope);
    else await denyMobileApproval(id);
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
    ? `<button type="button" class="pm-msg-action" data-msg-action="edit" data-msg-index="${index}">${ICONS.wand}<span>Edit</span></button>`
    : `<button type="button" class="pm-msg-action" data-msg-action="fork" data-msg-index="${index}">${ICONS.chev}<span>Fork</span></button>`;
  return `<div class="pm-msg-actions">
    <button type="button" class="pm-msg-action" data-msg-action="copy" data-msg-index="${index}">${ICONS.clipboard}<span>Copy</span></button>
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

function _renderChatMessageHtml(m, index = -1) {
  const msgIndex = Number.isFinite(Number(index)) ? Number(index) : -1;
  const attachments = Array.isArray(m.body?.attachments) ? m.body.attachments : [];
  const attachmentHtml = attachments.length ? _renderChatAttachmentPreviews(attachments, false) : '';
  if (m.role === 'user') {
    const bodyHtml = __pmChat.editingMessageIndex === msgIndex
      ? _renderMobileUserEditComposer(m, msgIndex, attachmentHtml)
      : `<div class="markdown-body">${_renderMobileMarkdown(m.body.text)}</div>${attachmentHtml}<span class="pm-time">${escapeHtml(m.time)}</span>`;
    return `<div class="pm-msg from-user${m.workflowGroupId ? ' workflow-linked' : ''}${m.workflowPart ? ` workflow-${escapeHtml(String(m.workflowPart))}` : ''}" data-msg-index="${msgIndex}">
      ${m.workflowLabel ? `<div class="pm-workflow-chip">${escapeHtml(m.workflowLabel)}</div>` : ''}
      <div class="pm-bubble">${bodyHtml}</div>${_renderMobileMessageActions(m, msgIndex)}</div>`;
  }
  const b = m.body || {};
  let inner = '';
  if (b.sender) inner += `<span class="pm-sender">${escapeHtml(b.sender)}</span>`;
  if (m.streaming && Array.isArray(m.liveTraceEntries) && m.liveTraceEntries.length) {
    inner += _renderMobileLiveTrace(m.liveTraceEntries);
  }
  if (b.text && !(m.streaming && Array.isArray(m.liveTraceEntries) && m.liveTraceEntries.length)) {
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
  inner += _renderMobileMediaGallery(_collectMessageMedia(m));
  inner += _renderMobileProcess(m.processEntries || b.processEntries);
  if (m.time) inner += `<span class="pm-time">${escapeHtml(m.time)}</span>`;
  return `<div class="pm-msg from-ai${m.workflowGroupId ? ' workflow-linked' : ''}${m.workflowPart ? ` workflow-${escapeHtml(String(m.workflowPart))}` : ''}" data-msg-index="${msgIndex}"${m.streaming ? ' data-streaming="1"' : ''}>
    ${m.workflowLabel ? `<div class="pm-workflow-chip">${escapeHtml(m.workflowLabel)}</div>` : ''}
    <div class="pm-bubble">${inner}</div>${_renderMobileMessageActions(m, msgIndex)}</div>`;
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
  _reindexMobileThread(__pmChat.thread);
  threadEl.innerHTML = __pmChat.thread.map((msg, index) => _renderChatMessageHtml(msg, index)).join('');
  threadEl.querySelectorAll('[data-pm-approval-action][data-pm-approval-id]').forEach((btn) => {
    btn.addEventListener('click', () => _resolveMobileApprovalButton(btn));
  });
  _wireMobileProcessRunActions(threadEl);
  _wireMobileMediaCards(threadEl);
}

function _scheduleThreadRender(threadEl, bodyEl, key = 'chat', delay = 90) {
  if (!threadEl) return;
  const timerKey = String(key || 'chat');
  if (__pmChat.renderTimers?.[timerKey]) return;
  __pmChat.renderTimers[timerKey] = setTimeout(() => {
    delete __pmChat.renderTimers[timerKey];
    _renderThread(threadEl);
    _scrollChat(bodyEl);
  }, Math.max(16, Number(delay) || 90));
}

function _flushThreadRender(threadEl, bodyEl, key = 'chat') {
  const timerKey = String(key || 'chat');
  if (__pmChat.renderTimers?.[timerKey]) {
    clearTimeout(__pmChat.renderTimers[timerKey]);
    delete __pmChat.renderTimers[timerKey];
  }
  _renderThread(threadEl);
  _scrollChat(bodyEl);
}

function _scrollChat(bodyEl) {
  if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
}

const PM_CHAT_SLASH_COMMANDS = [
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

export function renderChatPage(page, { navigate, sessionId = null }) {
  _installMobileApprovalBridge();
  let requestedSession = String(sessionId || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
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
      <input id="pm-file-input" type="file" multiple accept="image/*,.txt,.md,.json,.csv,.tsv,.log,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.yaml,.yml,application/pdf" hidden />
      <div class="pm-chat-slash-popover" id="pm-chat-slash-popover" hidden></div>
      <div class="pm-attach-tray" id="pm-attach-tray" hidden></div>
      <button type="button" class="pm-command-chip" id="pm-chat-command-chip" hidden aria-label="Clear slash command">
        <span class="pm-command-chip-token"></span>
        <span class="pm-command-chip-clear" aria-hidden="true">&times;</span>
      </button>
      <div class="pm-composer-row">
        <button type="button" class="pm-icon-btn" id="pm-attach-btn" aria-label="Attach files">${ICONS.paperclip}</button>
        <input class="pm-composer-input" id="pm-composer-input" placeholder="Type a message…" aria-label="Message" autocomplete="off" />
        <button type="button" class="pm-icon-btn" id="pm-chat-mic-btn" aria-label="Voice input">${ICONS.micSmall}</button>
        <button type="submit" class="pm-send" id="pm-send-btn" aria-label="Send">${ICONS.send}</button>
      </div>
    </form>
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
  const fileInput = page.querySelector('#pm-file-input');
  const attachTray = page.querySelector('#pm-attach-tray');
  const commandChip = page.querySelector('#pm-chat-command-chip');

  _pmRefreshSlashChrome(page, input);

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

  _renderThread(threadEl);
  _scrollChat(body);
  renderPendingAttachments();

  function updateOnlineStatus() {
    const pill = page.querySelector('.pm-online');
    if (!pill) return;
    loadGatewayStatus()
      .then(() => {
        pill.textContent = 'Online';
        pill.classList.remove('offline');
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
          history.map((msg, index) => _mapServerMessageToMobile(msg, index)),
          localThread,
        );
        _activeMobileThread();
        _renderThread(threadEl);
        _scrollChat(body);
        refreshMobileRunRecovery({ silent: true });
      })
      .catch((err) => {
        if (__pmChat.activeSessionId !== requestedSession) return;
        threadEl.innerHTML = `<div class="pm-chat-loading error">Could not load chat: ${escapeHtml(err.message || 'Unknown error')}</div>`;
      });
  }

  async function refreshMobileRunRecovery({ silent = false } = {}) {
    const remembered = _readMobileActiveRun(requestedSession);
    try {
      const status = await loadMobileChatRunStatus(requestedSession);
      if (!remembered && !status?.active) return;
      if (__pmChat.activeSessionId !== requestedSession) return;
      const activeThread = _activeMobileThread();
      let aiTurn = _findLatestAssistantTurn(activeThread);
      if (status?.active) {
        if (!aiTurn || !aiTurn.streaming) {
          aiTurn = { role: 'ai', streaming: true, time: '', timestamp: Date.now(), body: { sender: 'Prometheus', text: '' }, content: '' };
          activeThread.push(aiTurn);
        }
        aiTurn.streaming = true;
        const lastSeq = Math.max(
          Number(__pmChat.activeRuns?.[requestedSession]?.lastSeq || 0) || 0,
          Number(remembered?.lastSeq || 0) || 0,
        );
        const replay = await loadMobileChatStreamReplay(requestedSession, lastSeq).catch(() => null);
        const events = Array.isArray(replay?.events) ? replay.events : [];
        for (const frame of events) {
          const applied = applyMobileChatStreamEvent(aiTurn, replayFrameToEvent(frame));
          if (applied === 'done' || applied === 'error') break;
        }
        if (!events.length) {
          _appendMobileProcess(aiTurn, 'info', 'Connected to the live turn. Waiting for the next update.');
          _appendMobileLiveTrace(aiTurn, 'tool', 'Connecting to live run...');
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
          history.map((msg, index) => _mapServerMessageToMobile(msg, index)),
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
      if (!silent) pmToast(`Recovery check failed: ${err.message || err}`, 'warn');
    }
  }

  refreshMobileRunRecovery({ silent: true });
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
    sendBtn.disabled = false;
    sendBtn.classList.toggle('is-abort', shouldAbort);
    sendBtn.title = shouldAbort ? 'Stop Prometheus' : sessionBusy ? 'Queue message' : 'Send';
    sendBtn.innerHTML = shouldAbort
      ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>`
      : ICONS.send;
    sendBtn.setAttribute('aria-label', shouldAbort ? 'Stop' : sessionBusy ? 'Queue message' : 'Send');
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
    if (!aiTurn || !evt?.type) return '';
    if (!noteChatStreamSeq(evt)) return 'duplicate';
    switch (evt.type) {
      case 'token':
        if (evt.text) {
          aiTurn.body.text += String(evt.text);
          aiTurn.content = String(aiTurn.body.text || '');
          _appendMobileLiveTrace(aiTurn, 'assistant', String(evt.text), { append: true });
        }
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
          renderThreadSoon();
        }
        return 'streaming';
      case 'tool_call': {
        const label = _mobileToolLabel(evt);
        const args = _safeJsonPreview(evt.args || evt.params || evt.input);
        _appendMobileProcess(aiTurn, 'tool', `${label}${args ? `: ${args}` : ''}`, evt);
        _appendMobileLiveTrace(aiTurn, 'tool', `${label}${args ? `: ${args}` : ''}`);
        renderThreadSoon();
        return 'streaming';
      }
      case 'tool_result': {
        const label = _mobileToolLabel(evt);
        const result = _safeJsonPreview(evt.result || evt.output || evt.error || '', 180);
        _collectMediaFromToolEvent(aiTurn, evt);
        _appendMobileProcess(aiTurn, evt.error ? 'error' : 'result', `${label}${result ? ` -> ${result}` : ' complete'}`, evt);
        _appendMobileLiveTrace(aiTurn, evt.error ? 'error' : 'result', `${label}${evt.error ? ' failed' : ' complete'}`);
        renderThreadSoon();
        return 'streaming';
      }
      case 'tool_progress': {
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
      case 'final':
        _collectMediaFromToolEvent(aiTurn, evt);
        if (evt.text) aiTurn.body.text = String(evt.text);
        renderThreadSoon();
        return 'final';
      case 'done':
        _collectMediaFromToolEvent(aiTurn, evt);
        if (evt.reply && !String(aiTurn.body.text || '').trim()) aiTurn.body.text = String(evt.reply);
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
    aiTurn.time = _nowTime();
    aiTurn.timestamp = Number(aiTurn.timestamp || Date.now()) || Date.now();
    aiTurn.content = String(aiTurn.body?.text || '');
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
      let localAbortRequested = false;
      if (__pmChat.activeRuns?.[requestedSession]?.busy) {
        __pmChat.activeRuns?.[requestedSession]?.abort?.abort();
        localAbortRequested = true;
      }
      try {
        const r = localAbortRequested ? { success: true, message: 'Main chat abort requested.' } : await stopMobileMainChat(requestedSession);
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
    const files = Array.isArray(options.attachments) ? options.attachments.slice() : getPendingAttachments().slice();
    const msg = String(text || '').trim();
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
      input.value = '';
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
      __pmChat.threads[requestedSession] = [];
      __pmChat.attachments[requestedSession] = [];
      try { window.history.replaceState(null, '', `${window.location.pathname || '/'}${window.location.search || ''}#mobile/chat/${encodeURIComponent(actualSessionId)}`); } catch {}
      requestedSession = actualSessionId;
    }
    const activeThread = __pmChat.threads[actualSessionId] || (__pmChat.threads[actualSessionId] = []);
    __pmChat.thread = activeThread;

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
      body: { sender: 'Prometheus', text: '' },
      content: '',
    };
    activeThread.push(aiTurn);
    renderThreadNow();

    let stoppedByUser = false;
    let turnFinished = false;

    const finishAiTurn = () => {
      if (turnFinished) return;
      turnFinished = true;
      if (stoppedByUser) {
        _appendMobileProcess(aiTurn, 'warn', 'Generation stopped by user. Gateway abort requested; process log preserved.');
        const streamed = String(aiTurn.body.text || '').trim();
        aiTurn.body.text = streamed
          ? `[Stopped by user]\n\n${streamed}`
          : '[Generation stopped by user. Gateway abort requested and process log preserved.]';
      }
      aiTurn.streaming = false;
      aiTurn.time = _nowTime();
      aiTurn.timestamp = Number(aiTurn.timestamp || Date.now()) || Date.now();
      aiTurn.content = String(aiTurn.body?.text || '');
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
        const message = err?.message || 'Chat error';
        if (err?.mobileStreamDisconnected) {
          aiTurn.body.text = aiTurn.body.text || "Connection dropped, but Prometheus may still be working. I'll keep checking and recover the result here.";
          aiTurn.streaming = true;
          _appendMobileProcess(aiTurn, 'warn', message);
          _rememberMobileActiveRun(actualSessionId, { disconnected: true });
          pmToast('Connection dropped - recovery mode is on.', 'warn');
          if (__pmChat.recoverTimer) clearTimeout(__pmChat.recoverTimer);
          __pmChat.recoverTimer = setTimeout(() => refreshMobileRunRecovery({ silent: true }), 2500);
        } else {
          aiTurn.body.text = (aiTurn.body.text ? aiTurn.body.text + '\n\n' : '') + `Warning: ${message}`;
          _appendMobileProcess(aiTurn, 'error', message);
          _clearMobileActiveRun(actualSessionId);
          pmToast(message, 'error');
          finishAiTurn();
        }
        renderThreadNow();
      },
      onDone: () => {
        if (!stoppedByUser && aiTurn.streaming && _readMobileActiveRun(actualSessionId)?.disconnected) {
          setBusy(true, actualSessionId);
          if (__pmChat.recoverTimer) clearTimeout(__pmChat.recoverTimer);
          __pmChat.recoverTimer = setTimeout(() => refreshMobileRunRecovery({ silent: true }), 2500);
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
    } };
    if (!__pmChat.activeRuns || typeof __pmChat.activeRuns !== 'object') __pmChat.activeRuns = {};
    __pmChat.activeRuns[actualSessionId] = {
      ...(__pmChat.activeRuns[actualSessionId] || {}),
      busy: true,
      abort: abortHandle,
    };
    __pmChat.abort = abortHandle;
  }

  const runRecoveryOnReturn = () => refreshMobileRunRecovery({ silent: true });
  const runRecoveryOnVisibility = () => {
    if (!document.hidden) runRecoveryOnReturn();
  };
  const onMainChatStreamEvent = (msg = {}) => {
    if (String(msg.sessionId || '') !== requestedSession) return;
    if (__pmChat.activeSessionId !== requestedSession) return;
    _markMobileSessionRunning(requestedSession, true);
    const activeThread = _activeMobileThread();
    let aiTurn = _findLatestAssistantTurn(activeThread);
    if (!aiTurn || !aiTurn.streaming) {
      aiTurn = { role: 'ai', streaming: true, time: '', timestamp: Date.now(), body: { sender: 'Prometheus', text: '' }, content: '' };
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
    const sid = String(msg.sessionId || '').trim();
    if (sid !== requestedSession) return;
    if (__pmChat.activeSessionId !== requestedSession) return;
    const activeThread = _activeMobileThread();
    const aiTurn = _findLatestAssistantTurn(activeThread);
    if (!aiTurn) return;
    const intent = String(msg.intent || 'unknown').trim() || 'unknown';
    const shouldAbort = msg.shouldAbortOriginalRun === true;
    _appendMobileProcess(aiTurn, shouldAbort ? 'warn' : 'info', `Voice interruption: ${intent}`, {
      eventId: msg.eventId || '',
      runtimeId: msg.runtimeId || '',
      intent,
      shouldAbortOriginalRun: shouldAbort,
    });
    if (shouldAbort && aiTurn.streaming && !__pmChat.activeRuns?.[requestedSession]?.abort) {
      const streamed = String(aiTurn.body?.text || aiTurn.content || '').trim();
      aiTurn.streaming = false;
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
  wsEventBus?.on?.('main_chat_stream_event', onMainChatStreamEvent);
  wsEventBus?.on?.('voice_interruption', onVoiceInterruptionEvent);
  wsEventBus?.on?.('voice_agent_tool_event', onVoiceAgentToolEvent);
  const previousCleanup = typeof page._pmCleanup === 'function' ? page._pmCleanup : null;
  page._pmCleanup = () => {
    previousCleanup?.();
    window.removeEventListener('focus', runRecoveryOnReturn);
    document.removeEventListener('visibilitychange', runRecoveryOnVisibility);
    wsEventBus?.off?.('main_chat_stream_event', onMainChatStreamEvent);
    wsEventBus?.off?.('voice_interruption', onVoiceInterruptionEvent);
    wsEventBus?.off?.('voice_agent_tool_event', onVoiceAgentToolEvent);
    if (__pmChat.recoverTimer) {
      clearTimeout(__pmChat.recoverTimer);
      __pmChat.recoverTimer = null;
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = _pmGetComposerValue(input);
    if (/^\/browse(\s|$)/i.test(text.trim())) {
      const path = text.trim().slice('/browse'.length).trim();
      input.value = '';
      _pmClearActiveSlashCommand(page, input, { focus: false });
      handleBrowseCommand(path);
      return;
    }
    if (normalizeBareSlashCommand(text)) {
      input.value = '';
      _pmClearActiveSlashCommand(page, input, { focus: false });
      handleImmediateSlashCommand(text);
      return;
    }
    const activeSid = String(__pmChat.activeSessionId || requestedSession || MOBILE_CHAT_SESSION_ID);
    const hasAttachments = getPendingAttachments().length > 0;
    const activeAbort = __pmChat.activeRuns?.[activeSid]?.abort || __pmChat.activeRuns?.[requestedSession]?.abort;
    if ((__pmChat.activeRuns?.[activeSid]?.busy || __pmChat.activeRuns?.[requestedSession]?.busy) && !text.trim() && !hasAttachments) {
      activeAbort?.abort?.();
      updateComposerSubmitState();
      return;
    }
    input.value = '';
    _pmClearActiveSlashCommand(page, input, { focus: false });
    updateComposerSubmitState();
    sendMessage(text);
  });

  threadEl?.addEventListener('click', (event) => {
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
    _pmHandleSlashInput(page, input);
    updateComposerSubmitState();
  });
  input?.addEventListener('keydown', (e) => {
    const suggestions = _pmSlashCommandSuggestions(input.value);
    const popoverOpen = !page.querySelector('#pm-chat-slash-popover')?.hidden && suggestions.length > 0;
    if (!popoverOpen) {
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

  attachBtn?.addEventListener('click', () => fileInput?.click());
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

function _loadVoiceSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(PM_VOICE_SETTINGS_KEY) || '{}');
    const legacyMode =
      saved.voiceMode ||
      (saved.sttProvider === 'openai_realtime' || saved.ttsProvider === 'openai_realtime' ? 'openai_realtime' :
        (saved.sttProvider === 'xai' || saved.ttsProvider === 'xai' ? 'xai' : 'default'));
    return {
      voiceMode: legacyMode,
      sttProvider: saved.sttProvider || 'auto',
      ttsProvider: saved.ttsProvider || 'auto',
      realtimeVoice: saved.realtimeVoice || 'marin',
      realtimeSpeed: Number(saved.realtimeSpeed || 1.05),
      serverVoice: saved.serverVoice || '',
      xaiSpeed: Number(saved.xaiSpeed || saved.realtimeSpeed || 1.0),
      dictation: saved.dictation || 'milestone',
      sttProviderLocked: saved.sttProviderLocked === true,
    };
  } catch {
    return { voiceMode: 'default', sttProvider: 'auto', ttsProvider: 'auto', realtimeVoice: 'marin', realtimeSpeed: 1.05, serverVoice: '', xaiSpeed: 1.0, dictation: 'milestone', sttProviderLocked: false };
  }
}

function _saveVoiceSettings(settings) {
  __pmVoice.settings = { ...__pmVoice.settings, ...settings };
  __pmVoice.dictation = __pmVoice.settings.dictation || __pmVoice.dictation || 'milestone';
  try { localStorage.setItem(PM_VOICE_SETTINGS_KEY, JSON.stringify(__pmVoice.settings)); } catch {}
}

// Persistent voice state across navigation.
const __pmVoice = (window.__pmVoice = window.__pmVoice || {
  recent: [],          // [{id, request, currentTool, finalText, toolStream: [], status, ts, expanded}]
  lastAi: '',          // last final response text
  dictation: 'milestone', // 'quiet' | 'milestone'
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
if (!['default', 'openai_realtime', 'xai'].includes(__pmVoice.settings.voiceMode)) __pmVoice.settings.voiceMode = 'default';
if (!__pmVoice.settings.sttProviderLocked && !['auto', 'browser', 'openai_realtime'].includes(__pmVoice.settings.sttProvider)) {
  __pmVoice.settings.sttProvider = 'auto';
}
if (__pmVoice.settings.ttsProvider === 'browser') __pmVoice.settings.ttsProvider = 'auto';
__pmVoice.dictation = __pmVoice.settings.dictation || __pmVoice.dictation || 'milestone';

function _voiceSetStatus(s, hint) {
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
  const mode = String(settings.voiceMode || 'default');
  const realtimeReady = !!(realtime?.configured && (realtime?.oauthConfigured || realtime?.apiKeyConfigured));
  const xaiTtsReady = configuredTts.some(p => p?.id === 'xai');
  const xaiSttReady = configuredStt.some(p => p?.id === 'xai');
  if (mode === 'openai_realtime' && realtimeReady) {
    return {
      id: 'openai_realtime',
      label: 'OpenAI Realtime',
      model: realtime.model || 'gpt-realtime',
      voice: settings.realtimeVoice || realtime.voice || 'marin',
      speed: Number(settings.realtimeSpeed || 1.05),
      canRealtime: true,
      sttProvider: 'openai_realtime',
      ttsProvider: 'openai_realtime',
      ttsVoice: settings.realtimeVoice || realtime.voice || 'marin',
    };
  }
  if (mode === 'xai' && xaiTtsReady && xaiSttReady) {
    return {
      id: 'xai',
      label: 'xAI / Grok',
      canRealtime: false,
      sttProvider: 'xai',
      ttsProvider: 'xai',
      ttsVoice: settings.serverVoice || 'eve',
      speed: Number(settings.xaiSpeed || 1.0),
    };
  }
  return {
    id: 'browser',
    label: mode === 'openai_realtime' && !realtimeReady
      ? 'Default (OpenAI unavailable)'
      : (mode === 'xai' && (!xaiTtsReady || !xaiSttReady) ? 'Default (xAI unavailable)' : 'Default'),
    canRealtime: false,
    sttProvider: 'browser',
    ttsProvider: 'browser',
    requestedMode: mode,
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

function _voiceSpokenMilestone(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
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
  const spoken = String(text || '').replace(/\s+/g, ' ').trim();
  if (!spoken || __pmVoice.dictation !== 'milestone') return;
  __pmVoice.lastVoiceMilestone = spoken.slice(0, 500);
  const now = Date.now();
  const recent = __pmVoice.milestoneRecent instanceof Map ? __pmVoice.milestoneRecent : new Map();
  for (const [key, at] of recent.entries()) {
    if (!at || now - at > 45000) recent.delete(key);
  }
  const key = spoken.toLowerCase();
  if (recent.has(key)) return;
  recent.set(key, now);
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
      await _ttsSpeak(spoken);
    })
    .catch((err) => console.warn('[voice] milestone narration failed', err));
}

function _isBenignRealtimeCancelError(data) {
  const message = String(data?.error?.message || data?.error || data?.message || '').toLowerCase();
  return /cancell?ation failed|no active response|response not found|active response in progress|conversation already has an active response/.test(message);
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
  return String(pc?.localDescription?.sdp || '').trim();
}

async function _waitForLocalRealtimeOfferSdp(pc) {
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
  const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
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
    let startedAt = Date.now();
    const markSpeaking = () => {
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
    audio.onplay = markSpeaking;
    audio.onplaying = markSpeaking;
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
    audio.onpause = () => finish();
    audio.onerror = () => {
      if (settled) return;
      settled = true;
      _markVoiceSpeakingEnd();
      reject(new Error('Audio playback failed'));
    };
    try { audio.playbackRate = Math.max(0.5, Math.min(2, Number(playbackRate) || 1)); } catch {}
    try { audio.load?.(); } catch {}
    markSpeaking();
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
    const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
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

async function _ttsSpeak(text) {
  if (!text) return;
  __pmVoice.currentSpokenSegment = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
  const provider = __pmVoice.provider?.ttsProvider || 'browser';
  const mode = String(__pmVoice.settings?.voiceMode || 'default');
  _voiceDebug('tts-start', { textLen: String(text || '').length, mode, provider });
  const explicitVoiceMode = mode === 'openai_realtime' || mode === 'xai';
  const wantsRealtime = mode === 'openai_realtime' && provider === 'openai_realtime';
  let realtimeReady = !!(__pmVoice.provider?.canRealtime || _isRealtimeConnected());
  if (wantsRealtime && !realtimeReady) {
    try {
      const status = await loadVoiceStatus();
      __pmVoice.lastVoiceStatus = status;
      __pmVoice.voiceStatus = status?.voice || null;
      const detected = _detectProvider(status);
      __pmVoice.provider = { ...detected, sttProvider: __pmVoice.provider?.sttProvider || 'browser' };
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
  // Gate v2 (xaitts-gate2): xAI TTS is preferred whenever it's server-configured
  // and the user isn't currently on the OpenAI Realtime path. We deliberately do
  // NOT require voiceMode==='xai' — iOS Safari's stale SW cache kept making the
  // strict gate route around xai and fall to browser speechSynthesis (orb flashes
  // then dies). Set window.__pmDisableXaiTts=true at runtime to opt out.
  const xaiTtsConfigured = Array.isArray(__pmVoice.voiceStatus?.ttsProviders)
    && __pmVoice.voiceStatus.ttsProviders.some(p => p?.id === 'xai' && p?.configured);
  const xaiDisabled = !!(typeof window !== 'undefined' && window.__pmDisableXaiTts);
  const wantsXai = mode === 'xai' || provider === 'xai' || __pmVoice.provider?.id === 'xai';
  const providersToTry = ((wantsXai || xaiTtsConfigured) && !xaiDisabled && mode !== 'openai_realtime') ? ['xai'] : [];
  try { console.log('[voice] xai TTS gate v2', { mode, provider, xaiTtsConfigured, willTry: providersToTry }); } catch {}
  _voiceDebug('tts-gate', { mode, provider, xaiTtsConfigured, wantsXai, providersToTry });
  for (const ttsProvider of providersToTry) {
    try {
      _voiceSetStatus('Speaking with xAI / Grok', 'Grok voice audio is generating the response');
      _markVoiceSpeakingStart(text);
      const body = { provider: ttsProvider, text };
      if (ttsProvider === 'openai' && __pmVoice.provider?.ttsVoice) body.voice = __pmVoice.provider.ttsVoice;
      const xaiSpeed = Number(__pmVoice.settings?.xaiSpeed || __pmVoice.provider?.speed || 1.0);
      const xaiVoice = String(__pmVoice.settings?.serverVoice || __pmVoice.provider?.ttsVoice || 'eve').trim();
      if (ttsProvider === 'xai' && xaiVoice) body.voiceId = xaiVoice;
      if (ttsProvider === 'xai') body.speed = xaiSpeed;
      if (ttsProvider === 'xai') body.delivery = 'url';
      _voiceDebug('tts-fetch-start', { provider: ttsProvider, voiceId: body.voiceId || '', delivery: body.delivery || '' });
      const audio = await synthesizeVoiceAudio(body);
      _voiceDebug('tts-fetch-ok', { provider: ttsProvider, mimeType: audio?.mimeType || '', hasBase64: !!audio?.audioBase64, hasUrl: !!(audio?.audioUrl || audio?.url) });
      await _playAudioBase64({ ...audio, playbackRate: ttsProvider === 'xai' ? xaiSpeed : 1 });
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
  _voiceDebug('tts-browser-fallback', { mode, provider });
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
    const result = await createVoiceInterruptionEvent(payload);
    __pmVoice.lastInterruptionEvent = result;
    const reply = String(result?.voiceReply || '').trim();
    if (reply) await _ttsSpeak(reply);
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

function _applyVoiceInterruptionToMobileChat(sessionId, result, transcript = '') {
  const sid = String(sessionId || '').trim();
  if (!sid || !result?.classification) return false;
  const thread = __pmChat.threads?.[sid];
  if (!Array.isArray(thread)) return false;
  const classification = result.classification || {};
  const intent = String(classification.intent || 'unknown').trim() || 'unknown';
  const shouldAbort = classification.shouldAbortOriginalRun === true;
  const asSteer = result.steerApplied === true && !shouldAbort;
  const latestAi = _findLatestAssistantTurn(thread);
  const transcriptText = String(transcript || '').trim();
  const workflowGroupId = `${asSteer ? 'chat_steer' : 'voice_workflow'}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const eventExtra = {
    eventId: result.steerEventId || result.eventId || '',
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
  });
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

  if (!latestAi || !latestAi.streaming) return false;
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
    _voiceSetStatus('Refreshing context', 'Checking the current worker before responding');
    const result = await mobileGatewayFetch('/api/voice-agent/input', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: sid,
        transcript: text,
        userInterruptionTranscript: text,
        source: 'mobile_voice_live_steer',
        clientRequestId: String(activeVoice?.activeRequestId || ''),
      }),
    });
    if (!result?.success && !result?.ok) return false;
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
    if (reply) await _ttsSpeak(reply);
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
    _voiceSetStatus('Checking context', 'Prometheus voice is preparing a reply');
    const result = await mobileGatewayFetch('/api/voice-agent/input', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: sid,
        transcript: text,
        userInterruptionTranscript: text,
        source: 'mobile_voice_handoff',
        voiceMode: String(__pmVoice.settings?.voiceMode || 'default'),
      }),
    });
    if (!result?.success && !result?.ok) return { shouldContinueToWorker: true, result: null };
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
        _voiceDebug('ack-tts-started', { sessionId: sid, elapsedMs: Date.now() - handoffStartedAt, nonBlocking: true });
        _ttsSpeak(reply)
          .then(() => _voiceDebug('ack-tts-dispatched', { sessionId: sid, elapsedMs: Date.now() - handoffStartedAt, nonBlocking: true }))
          .catch((err) => _voiceDebug('ack-tts-error', { sessionId: sid, elapsedMs: Date.now() - handoffStartedAt, message: err?.message || String(err) }));
      }
      _voiceDebug('worker-handoff-released', { sessionId: sid, elapsedMs: Date.now() - handoffStartedAt });
      return { shouldContinueToWorker: true, result };
    }
    if (reply) {
      _voiceDebug('ack-tts-started', { sessionId: sid, elapsedMs: Date.now() - handoffStartedAt, nonBlocking: false });
      await _ttsSpeak(reply);
      _voiceDebug('ack-tts-completed', { sessionId: sid, elapsedMs: Date.now() - handoffStartedAt, nonBlocking: false });
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

function _startVoiceAgentNarrationLoop(sessionId, requestId) {
  const sid = String(sessionId || '').trim();
  const rid = String(requestId || '').trim();
  if (!sid || !rid) return () => {};
  let stopped = false;
  let inFlight = false;
  const tick = async () => {
    if (stopped || inFlight || __pmVoice.dictation !== 'milestone') return;
    if (__pmVoice.activeVoiceRuntime?.activeRequestId !== rid) return;
    inFlight = true;
    try {
      const result = await mobileGatewayFetch('/api/voice-agent/narrate', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: sid,
          minGapMs: 5500,
          source: 'mobile_voice_narration',
        }),
      });
      const reply = String(result?.voiceReply || '').trim();
      if ((result?.action === 'reply' || reply) && reply) {
        _speakVoiceMilestone(reply, { minGapMs: 4500 });
      }
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
  const header = renderMobileHeader({
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
        <button type="button" class="pm-voice-mic" id="pm-voice-mic" aria-label="Hold to talk">${ICONS.mic}</button>
        <div id="pm-voice-provider-banner" style="margin-top:14px;font-size:12px;color:var(--pm-muted);"></div>
        <button id="pm-voice-settings-toggle" type="button" class="pm-btn ghost" style="margin-top:8px;padding:7px 13px;font-size:12px;">Voice Settings</button>
        <button id="pm-voice-session-target" type="button" style="margin-top:8px;border:1px solid var(--pm-border);background:var(--pm-bg-soft);color:var(--pm-text-soft);border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Target: resolving latest chat...</button>
        <div id="pm-voice-settings-panel" style="display:none;margin-top:10px;width:min(100%,430px);text-align:left;background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:12px;padding:10px;box-sizing:border-box;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <label style="font-size:11px;font-weight:800;color:var(--pm-muted);text-transform:uppercase;grid-column:1 / -1;">Voice Mode
              <select id="pm-voice-mode-provider" style="margin-top:4px;width:100%;border:1px solid var(--pm-border);border-radius:8px;padding:7px;background:var(--pm-surface-strong);color:var(--pm-text);color-scheme:light dark;"></select>
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

      <section style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 0 4px;">
        <button class="pm-btn ghost" id="pm-voice-repeat" style="padding:8px 14px;font-size:13px;display:inline-flex;align-items:center;gap:6px;">
          🔁 Repeat last response
        </button>
        <div style="display:inline-flex;align-items:center;gap:4px;background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:999px;padding:3px;font-size:12px;font-weight:700;">
          <button data-mode="quiet"     id="pm-voice-mode-quiet"     style="border:none;background:transparent;color:var(--pm-muted);padding:5px 11px;border-radius:999px;cursor:pointer;font-weight:700;">Quiet</button>
          <button data-mode="milestone" id="pm-voice-mode-milestone" style="border:none;background:var(--pm-orange);color:#fff;padding:5px 11px;border-radius:999px;cursor:pointer;font-weight:700;">Milestone</button>
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
  wireHeaderActions(page, {
    onNewChat: () => {
      _startMobileNewVoiceDraft();
      _paintVoiceTarget?.();
      pmToast('New voice chat started', 'success');
    },
  });

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
  const serverVoiceLabel = page.querySelector('#pm-voice-server-voice-label');
  const serverVoiceSelect = page.querySelector('#pm-voice-server-voice');
  const realtimeVoiceLabel = page.querySelector('#pm-voice-realtime-voice-label');
  const realtimeVoiceSelect = page.querySelector('#pm-voice-realtime-voice');
  const speedControl = page.querySelector('#pm-voice-speed-control');
  const speedInput = page.querySelector('#pm-voice-speed');
  const speedLabel = page.querySelector('#pm-voice-speed-label');
  const targetBtn  = page.querySelector('#pm-voice-session-target');
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

  let _activeApprovalId = null;
  let _activeVoiceCommandApprovalId = null;

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
    wsEventBus?.off?.('process_run_exited', _voiceProcessExitHandler);
    wsEventBus?.off?.('timer_done', _voiceTimerDoneHandler);
    if (__pmVoice.previewTimer) {
      clearTimeout(__pmVoice.previewTimer);
      __pmVoice.previewTimer = null;
    }
  };

  let _paintVoiceTarget = () => {};

  _paintVoiceTarget = () => {
    const sid = String(__pmVoice.targetSessionId || '').trim();
    const label = String(__pmVoice.targetSessionLabel || sid || 'Latest chat').trim();
    targetBtn.textContent = `Target: ${label}`;
    targetBtn.title = sid ? `${label}\n${sid}` : 'Voice commands will use the latest active chat.';
  };

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

  targetBtn.addEventListener('click', async () => {
    __pmVoice.targetSessionForced = false;
    __pmVoice.targetSessionId = '';
    targetBtn.textContent = 'Target: resolving latest chat...';
    const sid = await _resolveVoiceSessionTarget({ forceRefresh: true });
    pmToast(`Voice target: ${__pmVoice.targetSessionLabel || sid}`, 'info');
  });

  _resolveVoiceSessionTarget({ forceRefresh: !__pmVoice.targetSessionForced }).catch(() => {
    __pmVoice.targetSessionId = __pmVoice.targetSessionId || MOBILE_CHAT_SESSION_ID;
    __pmVoice.targetSessionLabel = __pmVoice.targetSessionLabel || 'Mobile - New Chat';
    _paintVoiceTarget();
  });

  // ── Provider detection ─────────────────────────────────────────────
  function _providerOptionHtml(id, label, selected) {
    return `<option value="${escapeHtml(id)}" ${id === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }

  function _paintVoiceSettings() {
    const settings = __pmVoice.settings || {};
    const sttProviders = Array.isArray(__pmVoice.voiceStatus?.sttProviders) ? __pmVoice.voiceStatus.sttProviders : [];
    const ttsProviders = Array.isArray(__pmVoice.voiceStatus?.ttsProviders) ? __pmVoice.voiceStatus.ttsProviders : [];
    const realtimeReady = _isRealtimeConnected(__pmVoice.lastVoiceStatus);
    const xaiReady = sttProviders.some(p => p?.configured && p?.id === 'xai') && ttsProviders.some(p => p?.configured && p?.id === 'xai');
    const selectedMode = ['default', 'openai_realtime', 'xai'].includes(settings.voiceMode) ? settings.voiceMode : 'default';
    voiceModeSelect.innerHTML = [
      _providerOptionHtml('default', 'Default', selectedMode),
      _providerOptionHtml('openai_realtime', `OpenAI Realtime${realtimeReady ? '' : ' (not connected)'}`, selectedMode),
      _providerOptionHtml('xai', `xAI / Grok${xaiReady ? '' : ' (not connected)'}`, selectedMode),
    ].join('');
    const selectedServerTts = selectedMode === 'xai' && xaiReady ? 'xai' : '';
    realtimeVoiceSelect.innerHTML = REALTIME_VOICE_OPTIONS
      .map(id => _providerOptionHtml(id, id[0].toUpperCase() + id.slice(1), settings.realtimeVoice || 'marin'))
      .join('');
    if (realtimeVoiceLabel) realtimeVoiceLabel.style.display = selectedMode === 'openai_realtime' ? '' : 'none';
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
    const speedValue = selectedMode === 'xai' ? Number(settings.xaiSpeed || 1.0) : Number(settings.realtimeSpeed || 1.05);
    if (speedControl) speedControl.style.display = ['openai_realtime', 'xai'].includes(selectedMode) ? '' : 'none';
    speedInput.min = selectedMode === 'xai' ? '0.5' : '0.75';
    speedInput.max = selectedMode === 'xai' ? '2' : '1.3';
    speedInput.step = selectedMode === 'xai' ? '0.05' : '0.05';
    speedInput.value = String(speedValue);
    speedLabel.textContent = `${Number(speedInput.value).toFixed(2)}x`;
  }

  function _recomputeVoiceProvider() {
    if (__pmVoice.lastVoiceStatus) __pmVoice.provider = _detectProvider(__pmVoice.lastVoiceStatus);
    _paintVoiceSettings();
  }

  function _paintProviderBanner() {
    const p = __pmVoice.provider || _detectProvider(__pmVoice.lastVoiceStatus || {});
    const mode = String(__pmVoice.settings?.voiceMode || 'default');
    let detail = mode === 'openai_realtime'
      ? (p.id === 'openai_realtime' ? 'Mode: <strong>OpenAI Realtime</strong>' : 'Mode: <strong>Default</strong> - OpenAI Realtime unavailable')
      : mode === 'xai'
        ? (p.id === 'xai' ? 'Mode: <strong>xAI / Grok</strong>' : 'Mode: <strong>Default</strong> - xAI/Grok unavailable')
        : 'Mode: <strong>Default</strong>';
    if (p.id === 'openai_realtime') detail += ` - ${escapeHtml(p.voice || 'marin')}`;
    if (p.id === 'xai') detail += ` - ${escapeHtml(p.ttsVoice || 'eve')}`;
    banner.innerHTML = detail + ` - <a href="#" id="pm-voice-settings" style="color:var(--pm-orange);font-weight:700;text-decoration:none;">Settings</a>`;
    page.querySelector('#pm-voice-settings')?.addEventListener('click', e => {
      e.preventDefault();
      settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
    });
  }

  settingsToggle.addEventListener('click', () => {
    settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
  });
  voiceModeSelect.addEventListener('change', () => {
    const mode = voiceModeSelect.value || 'default';
    _saveVoiceSettings({
      voiceMode: mode,
      sttProvider: mode === 'openai_realtime' ? 'openai_realtime' : (mode === 'xai' ? 'xai' : 'browser'),
      ttsProvider: mode === 'openai_realtime' ? 'openai_realtime' : (mode === 'xai' ? 'xai' : 'browser'),
      serverVoice: mode === 'xai' ? (__pmVoice.settings?.serverVoice || 'eve') : '',
      sttProviderLocked: true,
    });
    _recomputeVoiceProvider();
    _paintProviderBanner();
  });
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
    const mode = String(__pmVoice.settings?.voiceMode || 'default');
    _saveVoiceSettings(mode === 'xai' ? { xaiSpeed: Number(speedInput.value) } : { realtimeSpeed: Number(speedInput.value) });
    _recomputeVoiceProvider();
    _paintProviderBanner();
  });

  loadVoiceStatus().then(status => {
    __pmVoice.lastVoiceStatus = status;
    __pmVoice.voiceStatus = status?.voice || null;
    __pmVoice.provider = _detectProvider(status);
    _paintVoiceSettings();
    _paintProviderBanner();
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
    if (!target) return;
    target.classList.remove('listening', 'thinking', 'speaking', 'confirmed');
    if (state) target.classList.add(state);
  }

  // ── Repeat last ───────────────────────────────────────────────────
  function _refreshRepeatBtn() {
    repeatBtn.disabled = !__pmVoice.lastAi;
    repeatBtn.style.opacity = __pmVoice.lastAi ? '' : '0.45';
  }
  _refreshRepeatBtn();
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

  function _setStatus(s, hint) { _voiceSetStatus(s, hint); }

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
    _closeRealtimeSpeechConnection();
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
    return mode === 'openai_realtime' && _isRealtimeConnected(status);
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
      if (!pressArm) {
        _setOrbState(null);
        _setStatus('Ready', 'Tap and hold the mic to speak');
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
        try { await audioContext?.close?.(); } catch {}
        if (xaiStreamingStt?.ws === ws) xaiStreamingStt = null;
      };
      const fallbackToBatch = async (reason) => {
        if (fellBack || !pressArm) return;
        fellBack = true;
        _voiceDebug('xai-stream-stt-fallback', { elapsedMs: Date.now() - startedAt, reason: String(reason || '').slice(0, 300) });
        await cleanupStreaming();
        __pmVoice.listening = false;
        mic.classList.remove('recording');
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
          return;
        }
        if (type === 'transcript.partial' || type === 'transcript.done') {
          _appendXaiStreamingTranscript(data);
          if (type === 'transcript.done') {
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
      await audioContext.resume?.();
    } catch (err) {
      _voiceDebug('xai-stream-stt-error', { elapsedMs: Date.now() - startedAt, message: String(err?.message || err).slice(0, 500) });
      try { xaiStreamingStt?.ws?.close?.(); } catch {}
      try { xaiStreamingStt?.processor?.disconnect?.(); } catch {}
      try { xaiStreamingStt?.source?.disconnect?.(); } catch {}
      try { xaiStreamingStt?.mutedGain?.disconnect?.(); } catch {}
      try { await xaiStreamingStt?.audioContext?.close?.(); } catch {}
      xaiStreamingStt = null;
      console.warn('[voice] xAI streaming STT failed, falling back to batch STT', err);
      pmToast('xAI streaming STT failed; using batch transcription', 'error');
      return _startBackendListening('xai');
    }
  }

  function _stopXaiStreamingListening(abort) {
    const conn = xaiStreamingStt;
    xaiStreamingStt = null;
    if (!conn) return;
    conn.stopping = true;
    try { conn.processor?.disconnect?.(); } catch {}
    try { conn.source?.disconnect?.(); } catch {}
    try { conn.mutedGain?.disconnect?.(); } catch {}
    try { conn.audioContext?.close?.(); } catch {}
    if (abort) {
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
    setTimeout(() => {
      try { conn.ws?.close?.(); } catch {}
      const text = _currentRealtimeTranscript();
      __pmVoice.realtimeTranscript = '';
      __pmVoice.realtimeDeltas = new Map();
      _submitSpeech(text);
    }, 450);
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
    let stream = null;
    try {
      _setOrbState('thinking');
      _setStatus('Connecting...', 'Starting OpenAI Realtime transcription');
      _voiceDebug('realtime-stt-start', {
        hasWarmMic: !!__pmVoice.warmMicStream,
        realtimeConnected: _isRealtimeConnected(),
      });
      stream = await _ensureWarmMic();
      if (!pressArm) {
        _setOrbState(null);
        _setStatus('Ready', 'Tap and hold the mic to speak');
        return;
      }
      const pc = new RTCPeerConnection();
      stream.getAudioTracks().forEach(track => pc.addTrack(track, stream));
      const dc = pc.createDataChannel('oai-events');
      realtimeTranscription = { pc, dc, stream, stopping: false };

      dc.addEventListener('message', (messageEvent) => {
        let data = null;
        try { data = JSON.parse(messageEvent.data); } catch { return; }
        const type = String(data?.type || '');
        if (type === 'input_audio_buffer.speech_started') {
          __pmVoice.realtimeUtteranceStartedAt = Date.now();
          __pmVoice.realtimeFirstDeltaLogged = false;
          _voiceDebug('mic-speech-started', { provider: 'openai_realtime' });
          _captureVoicePlaybackInterrupt('barge_in');
          _ttsStop();
          _setStatus('Listening...', 'I hear you');
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
          return;
        }
        if (type === 'conversation.item.input_audio_transcription.completed') {
          _captureVoicePlaybackInterrupt('barge_in');
          _ttsStop();
          _voiceDebug('stt-final', {
            provider: 'openai_realtime',
            itemId: String(data?.item_id || ''),
            elapsedMs: Date.now() - Number(__pmVoice.realtimeUtteranceStartedAt || Date.now()),
            textLen: String(data?.transcript || '').length,
          });
          _appendRealtimeTranscript(String(data?.item_id || ''), data?.transcript || '');
          return;
        }
        if (type === 'conversation.item.input_audio_transcription.failed' || type === 'error') {
          const message = data?.error?.message || data?.error || 'Realtime transcription failed';
          pmToast(String(message), 'error');
        }
      });

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
      if (!pressArm) {
        try { dc.close?.(); } catch {}
        try { pc.close?.(); } catch {}
        realtimeTranscription = null;
        _setOrbState(null);
        _setStatus('Ready', 'Tap and hold the mic to speak');
        return;
      }

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
      try { conn?.dc?.close?.(); } catch {}
      try { conn?.pc?.close?.(); } catch {}
      __pmVoice.realtimeTranscript = '';
      __pmVoice.realtimeDeltas = new Map();
      _setOrbState(null);
      _setStatus('Ready', 'Tap and hold the mic to speak');
      return;
    }
    _setOrbState('thinking');
    _setStatus('Transcribing...', 'Finalizing realtime transcript');
    setTimeout(() => {
      const text = _currentRealtimeTranscript();
      try { conn?.dc?.close?.(); } catch {}
      try { conn?.pc?.close?.(); } catch {}
      __pmVoice.realtimeTranscript = '';
      __pmVoice.realtimeDeltas = new Map();
      _submitSpeech(text);
    }, 1000);
  }

  async function _submitSpeech(text) {
    const finalText = String(text || '').trim();
    if (!finalText) { _setStatus('Ready', 'Tap and hold the mic to speak'); _setOrbState(null); return; }
    const activeVoiceRuntime = __pmVoice.activeVoiceRuntime || null;
    let targetSessionId = activeVoiceRuntime?.isStreamActive === true && activeVoiceRuntime?.sessionId
      ? String(activeVoiceRuntime.sessionId).trim()
      : await _resolveVoiceSessionTarget({ forceRefresh: !__pmVoice.targetSessionForced });
    if (targetSessionId === MOBILE_CHAT_SESSION_ID) {
      const actualSessionId = createMobileChatSessionId();
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
      __pmVoice.targetSessionLabel = 'Mobile - Voice chat';
      __pmVoice.targetSessionChannel = 'mobile';
      __pmVoice.targetSessionForced = true;
      targetSessionId = actualSessionId;
      _paintVoiceTarget?.();
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
    if (!hadPendingInterruption && !interruptionResult?.classification) {
      const voiceAgentHandoff = await _prepareVoiceAgentHandoff(targetSessionId, finalText);
      if (!voiceAgentHandoff.shouldContinueToWorker) {
        _setOrbState(null);
        _renderRecent();
        return;
      }
      if (voiceAgentHandoff.result) __pmVoice.lastHandoffEvent = voiceAgentHandoff.result;
    }
    if (!__pmChat.threads[targetSessionId]) __pmChat.threads[targetSessionId] = [];
    const chatThread = __pmChat.threads[targetSessionId];
    if (!interruptionResult?.classification) {
      chatThread.push({ role: 'user', time: _nowTime(), body: { text: finalText, source: 'voice' } });
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
    const handoffAck = String(handoffResult?.voiceReply || '').trim();
    const backendHandoffContext = String(handoffResult?.injectedContextText || '').trim();
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
    const callerContext = [interruptionCallerContext || _consumeVoicePlaybackInterruptContext(targetSessionId), handoffContext]
      .filter(Boolean)
      .join('\n\n');
    const voiceWorkerHandoffStartedAt = Date.now();
    let voiceWorkerFirstPreflightLogged = false;
    let voiceWorkerFirstTokenLogged = false;
    _voiceDebug('worker-handoff-starting', { sessionId: targetSessionId, requestId: cmd.id });
    const interruptionIntent = String(interruptionResult?.classification?.intent || '').trim();
    if (interruptionCallerContext && (interruptionIntent === 'cancel' || interruptionIntent === 'pause' || interruptionIntent === 'unknown')) {
      const reply = String(interruptionResult?.voiceReply || (interruptionIntent === 'cancel' ? 'Cancelled.' : interruptionIntent === 'pause' ? 'Paused.' : 'I heard you interrupt, but I did not catch that clearly.')).trim();
      cmd.status = interruptionIntent === 'cancel' ? 'cancelled' : interruptionIntent;
      cmd.currentTool = interruptionIntent;
      cmd.finalText = reply;
      chatAiTurn.streaming = false;
      chatAiTurn.time = _nowTime();
      chatAiTurn.body.text = reply;
      _appendMobileProcess(chatAiTurn, 'info', `Voice interruption: ${interruptionIntent}`);
      __pmVoice.lastAi = reply;
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
    const stopVoiceAgentNarration = _startVoiceAgentNarrationLoop(targetSessionId, cmd.id);

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
        if (__pmVoice.dictation === 'milestone' && spokenMilestone && spokenMilestone !== lastSpokenMilestone) {
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
        cmd.status = 'streaming';
        _updateToolFlip(cmd, 'responding...');
      },
      onVoiceMilestone: (evt) => {
        const text = String(evt?.text || '').trim();
        if (!text) return;
        cmd.toolStream.push(`voice: ${text}`);
        _appendMobileProcess(chatAiTurn, 'info', `Voice milestone: ${text}`, evt);
        if (cmd.expanded) _renderRecent();
        const spokenMilestone = _voiceSpokenMilestone(text);
        if (spokenMilestone) {
          _speakVoiceMilestone(spokenMilestone, { minGapMs: Number(evt?.minGapMs ?? 2500) || 2500 });
        }
      },
      onThinking: (m) => {
        _appendMobileProcess(chatAiTurn, 'think', String(m).slice(0, 220));
        _appendMobileLiveTrace(chatAiTurn, 'think', m, { append: true });
      },
      onToolCall: (evt) => {
        const label = _mobileToolLabel(evt);
        const args = _safeJsonPreview(evt.args || evt.params || evt.input);
        const text = `${label}${args ? `: ${args}` : ''}`;
        _appendMobileProcess(chatAiTurn, 'tool', text, evt);
        _appendMobileLiveTrace(chatAiTurn, 'tool', text);
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
        cmd.toolStream.push(`${evt.error ? '✗' : '✓'} ${resultText}`);
        if (cmd.expanded) _renderRecent();
      },
      onToolProgress: (evt) => {
        const progressText = `${_mobileToolLabel(evt)}: ${String(evt.message || '').trim()}`;
        _appendMobileProcess(chatAiTurn, 'info', progressText, evt);
        _appendMobileLiveTrace(chatAiTurn, 'tool', progressText);
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
        _ttsStop();
        finalSpoken = true;
        _ttsSpeak(aiBuf);
        _setOrbState('speaking');
        _setStatus('Speaking response', 'Tap mic again to follow up');
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
        window.wsEventBus?.off('approval_created', _wsApprovalHandler);
        _hideVoiceApproval();
        cmd.status = 'done';
        cmd.currentTool = 'complete';
        cmd.finalText = aiBuf;
        chatAiTurn.streaming = false;
        chatAiTurn.time = _nowTime();
        if (aiBuf) chatAiTurn.body.text = aiBuf;
        __pmVoice.lastAi = aiBuf;
        _refreshRepeatBtn();
        _renderRecent();
        if (!finalSpoken) {
          _ttsStop();                   // stop any milestone narration
          if (aiBuf) {
            finalSpoken = true;
            _ttsSpeak(aiBuf);  // always speak final response
          }
          _setOrbState('speaking');
          _setStatus('Speaking response', 'Tap mic again to follow up');
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
    const mode = String(__pmVoice.settings?.voiceMode || 'default');
    if (mode === 'openai_realtime') {
      if (!_isRealtimeConnected()) {
        pmToast('OpenAI Realtime is not connected; using Default', 'error');
        __pmVoice.provider = { ...(__pmVoice.provider || {}), sttProvider: 'browser', ttsProvider: 'browser', canRealtime: false };
        _startBrowserListening();
        return;
      }
      __pmVoice.provider = {
        ...(__pmVoice.provider || {}),
        id: 'openai_realtime',
        label: 'OpenAI Realtime',
        canRealtime: true,
        sttProvider: 'openai_realtime',
        ttsProvider: 'openai_realtime',
        voice: __pmVoice.settings?.realtimeVoice || __pmVoice.provider?.voice || 'marin',
        speed: Number(__pmVoice.settings?.realtimeSpeed || 1.05),
      };
      _setStatus('Connecting...', 'Starting OpenAI Realtime input and response audio');
      _startRealtimeTranscriptionListening();
      return;
    }
    if (mode === 'xai') {
      const sttProviders = Array.isArray(__pmVoice.voiceStatus?.sttProviders) ? __pmVoice.voiceStatus.sttProviders : [];
      const ttsProviders = Array.isArray(__pmVoice.voiceStatus?.ttsProviders) ? __pmVoice.voiceStatus.ttsProviders : [];
      const xaiTtsReady = ttsProviders.some(p => p?.configured && p?.id === 'xai');
      const xaiSttReady = sttProviders.some(p => p?.configured && p?.id === 'xai');
      if (!xaiTtsReady) {
        pmToast('xAI/Grok voice is not connected; using Default', 'error');
        __pmVoice.provider = { ...(__pmVoice.provider || {}), sttProvider: 'browser', ttsProvider: 'browser', canRealtime: false };
        _startBrowserListening();
        return;
      }
      __pmVoice.provider = {
        ...(__pmVoice.provider || {}),
        id: 'xai',
        label: 'xAI / Grok',
        sttProvider: 'xai',
        ttsProvider: 'xai',
        ttsVoice: __pmVoice.settings?.serverVoice || __pmVoice.provider?.ttsVoice || 'eve',
        speed: Number(__pmVoice.settings?.xaiSpeed || 1.0),
      };
      if (!xaiSttReady) {
        pmToast('xAI/Grok transcription is not connected; using Default input', 'error');
        _startBrowserListening();
        return;
      }
      _startXaiStreamingListening();
      return;
    }
    __pmVoice.provider = {
      ...(__pmVoice.provider || {}),
      sttProvider: 'browser',
      ttsProvider: 'browser',
      canRealtime: false,
    };
    _startBrowserListening();
    loadVoiceStatus().then(status => {
      __pmVoice.lastVoiceStatus = status;
      __pmVoice.voiceStatus = status?.voice || null;
      const detected = _detectProvider(status);
      __pmVoice.provider = { ...detected, sttProvider: 'browser', ttsProvider: 'browser' };
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
      _setOrbState(null);
      _setStatus('Ready', 'Tap and hold the mic to speak');
      return;
    }
    if (!pressArm) {
      _setOrbState(null);
      _setStatus('Ready', 'Tap and hold the mic to speak');
      return;
    }
    __pmVoice.listening = true;
    _setOrbState('listening');
    _setStatus('Listening…', 'Release to send');
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
      _setStatus('Listening…', (_latestBrowserTranscript() || '…').slice(0, 80));
    };
    rec.onerror = (e) => {
      console.warn('[voice] recognition error', e);
      pmToast(`Mic error: ${e.error || 'unknown'}`, 'error');
      _stopListening(true);
    };
    rec.onend = () => {
      if (__pmVoice.listening) _stopListening(false);
    };
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
      if (!pressArm) {
        _setOrbState(null);
        _setStatus('Ready', 'Tap and hold the mic to speak');
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

  function _beginHold(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
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

async function _renderTeamChatTab(slot, teamId) {
  slot.innerHTML = `
    <div class="pm-card" id="pm-team-chat-card" style="padding:0;overflow:hidden;">
      <div id="pm-team-chat-list" style="max-height:55vh;overflow-y:auto;padding:14px 14px 8px;"></div>
      <form id="pm-team-chat-form" style="display:flex;gap:8px;border-top:1px solid var(--pm-border);padding:10px 12px;">
        <input class="pm-input" id="pm-team-chat-input" placeholder="Message the team manager…" autocomplete="off" style="margin:0;flex:1;" />
        <button type="submit" class="pm-send" aria-label="Send" style="width:42px;height:42px;border-radius:50%;">${ICONS.send}</button>
      </form>
    </div>
  `;

  const listEl = slot.querySelector('#pm-team-chat-list');
  const form   = slot.querySelector('#pm-team-chat-form');
  const input  = slot.querySelector('#pm-team-chat-input');

  function renderList(messages) {
    if (!messages.length) {
      listEl.innerHTML = `<div style="text-align:center;color:var(--pm-muted);padding:24px 8px;font-size:13px;">No messages yet. Send the first one.</div>`;
      return;
    }
    listEl.innerHTML = messages.map(m => {
      const role = String(m.role || m.from || 'manager').toLowerCase();
      const fromUser = role === 'user' || role === 'you' || role === 'human';
      const time = m.createdAt ? _formatTimeAgo(m.createdAt) : '';
      const text = String(m.content || m.message || m.text || '');
      return `
        <div class="pm-msg ${fromUser ? 'from-user' : 'from-ai'}" style="max-width:92%;margin-bottom:10px;">
          <div class="pm-bubble">
            ${fromUser ? '' : `<span class="pm-sender">${escapeHtml(m.fromLabel || (role === 'manager' ? 'Manager' : role))}</span>`}
            ${escapeHtml(text).replace(/\n/g, '<br>')}
            ${time ? `<span class="pm-time">${escapeHtml(time)}</span>` : ''}
          </div>
        </div>`;
    }).join('');
    listEl.scrollTop = listEl.scrollHeight;
  }

  try {
    renderList(await loadTeamChat(teamId, 80));
  } catch (err) {
    listEl.innerHTML = `<div style="color:var(--pm-red);padding:16px;">${escapeHtml(err.message || 'Failed to load chat')}</div>`;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.disabled = true;
    try {
      await postTeamChat(teamId, text);
      renderList(await loadTeamChat(teamId, 80));
    } catch (err) {
      pmToast(err.message || 'Send failed', 'error');
    } finally {
      input.disabled = false;
      input.focus();
    }
  });
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
  if (current?.subscriptionActive || current?.isAdmin) return true;
  const result = await checkSessionDetailed({ timeoutMs: 3000 }).catch(() => null);
  const account = result?.account || getAccount();
  if (result?.authenticated && (account?.subscriptionActive || account?.isAdmin)) return true;

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
    setStage({ status: 'Sending pairing request…' });
    const r = await claimPairing({
      code,
      deviceName: _suggestedDeviceName(),
      deviceFingerprint: _deviceFingerprint(),
    });
    if (!r?.success || !r.requestId) throw new Error(r?.error || 'Failed to claim');
    requestId = r.requestId;
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
      setStage({ title: 'Pairing timed out', sub: 'The request expired. Please ask the desktop for a new QR.', status: '', actions: `<button class="pm-btn primary" id="pm-pair-newqr">Try again</button>` });
      page.querySelector('#pm-pair-newqr').addEventListener('click', () => { window.location.href = window.location.origin + '/#mobile/pair'; });
      return;
    }
    try {
      const r = await pollPairing(requestId);
      if (r.status === 'approved' && r.deviceToken) {
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
        setStage({ title: 'Pairing denied', sub: 'Your desktop user denied this request. You can try again with a new QR.', status: '', actions: `<button class="pm-btn primary" id="pm-pair-newqr">Try again</button>` });
        page.querySelector('#pm-pair-newqr').addEventListener('click', () => { window.location.href = window.location.origin + '/#mobile/pair'; });
        return;
      }
      if (r.status === 'expired' || r.status === 'not_found') {
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
  if (tool === 'run_command') {
    return {
      title: 'Command approval',
      summary: args.cwd ? `Run command in ${args.cwd}` : 'Run command',
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
  return String(approval?.toolName || '').trim() === 'run_command';
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

  const load = async () => {
    try {
      body.innerHTML = _pmMoreSkeleton();
      paint(await loadMobileMoreSummary());
    } catch (err) {
      body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.dots}</div><h2>Could not load More</h2><p>${escapeHtml(err.message || '')}</p></div>`;
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
  const extras = `<span class="pm-spacer"></span><button class="pm-icon-btn" type="button" onclick="shuffleMemoryGraph()" aria-label="Shuffle" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.spark}</button><button class="pm-icon-btn" type="button" onclick="refreshMemoryGraph(true)" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Memory Graph', leftIcon: 'back', onBack: () => navigate('#mobile/more'), online: true, extras, hideTitle: true, hideBrand: true })}
    <div class="pm-body pm-mobile-memory-body" id="pm-memory-body">
      <div class="memory-page-shell pm-mobile-memory-shell">
        <div class="memory-page-header pm-mobile-memory-actions">
          <input id="memory-image-input" type="file" accept="image/*" style="display:none" />
          <button class="memory-action-btn memory-action-btn--primary" type="button" onclick="openAddMemoryDrawer()">+ Add Memory</button>
          <button class="memory-action-btn" type="button" onclick="triggerMemoryImageInput()">Image Shape</button>
          <button id="memory-set-default-btn" class="memory-action-btn" type="button" style="opacity:0.4" onclick="toggleDefaultShape()">Set Default</button>
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
              </div>
            </section>
            <section class="memory-panel-card">
              <div class="memory-panel-title">Forces</div>
              <div class="memory-control-stack">
                <label class="memory-control">
                  <span>Repulsion</span>
                  <input id="memory-force-repulsion" type="range" min="20" max="220" step="1" value="90" />
                </label>
                <label class="memory-control">
                  <span>Link stiffness</span>
                  <input id="memory-force-link" type="range" min="1" max="100" step="1" value="26" />
                </label>
                <label class="memory-control">
                  <span>Collision</span>
                  <input id="memory-force-collision" type="range" min="0" max="100" step="1" value="24" />
                </label>
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
      <form id="pm-sa-chat-form" style="display:flex;gap:8px;border-top:1px solid var(--pm-border);padding:10px 12px;">
        <input class="pm-input" id="pm-sa-chat-input" placeholder="Message ${escapeHtml(agent.name)}…" autocomplete="off" style="margin:0;flex:1;" />
        <button type="submit" class="pm-send" aria-label="Send" style="width:42px;height:42px;border-radius:50%;">${ICONS.send}</button>
      </form>
    </div>
  `;

  const listEl = slot.querySelector('#pm-sa-chat-list');
  const form   = slot.querySelector('#pm-sa-chat-form');
  const input  = slot.querySelector('#pm-sa-chat-input');

  let messages = [];

  function renderList() {
    if (!messages.length) {
      listEl.innerHTML = `<div style="text-align:center;color:var(--pm-muted);padding:24px 8px;font-size:13px;">No messages yet. Send the first one to ${escapeHtml(agent.name)}.</div>`;
      return;
    }
    listEl.innerHTML = messages.map(m => {
      const role = String(m.role || 'agent').toLowerCase();
      const fromUser = role === 'user' || role === 'you' || role === 'human';
      const time = m.createdAt ? _formatTimeAgo(m.createdAt) : '';
      const text = String(m.content || m.text || '');
      const sender = fromUser ? '' : `<span class="pm-sender">${escapeHtml(agent.name)}</span>`;
      const progress = m._progress ? `<div class="pm-sa-progress">${escapeHtml(m._progress)}</div>` : '';
      return `
        <div class="pm-msg ${fromUser ? 'from-user' : 'from-ai'}" style="max-width:92%;margin-bottom:10px;">
          <div class="pm-bubble">
            ${sender}
            ${escapeHtml(text).replace(/\n/g, '<br>')}
            ${progress}
            ${time ? `<span class="pm-time">${escapeHtml(time)}</span>` : ''}
          </div>
        </div>`;
    }).join('');
    listEl.scrollTop = listEl.scrollHeight;
  }

  try {
    messages = await loadSubagentChat(agent.id, 80);
    renderList();
  } catch (err) {
    listEl.innerHTML = `<div style="color:var(--pm-red);padding:16px;">${escapeHtml(err.message || 'Failed to load chat')}</div>`;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.disabled = true;

    const userMsg = { role: 'user', content: text, createdAt: Date.now() };
    messages.push(userMsg);
    const agentMsg = { role: 'agent', content: '', _progress: `${agent.name} is thinking…`, createdAt: Date.now() };
    messages.push(agentMsg);
    renderList();

    const stream = streamSubagentChat(agent.id, { message: text }, {
      onToken: (chunk) => {
        agentMsg.content = (agentMsg.content || '') + chunk;
        agentMsg._progress = '';
        renderList();
      },
      onThinking: () => {
        agentMsg._progress = `${agent.name} is thinking…`;
        renderList();
      },
      onInfo: (msg) => {
        agentMsg._progress = String(msg).slice(0, 120);
        renderList();
      },
      onToolCall: (evt) => {
        const action = String(evt?.action || 'tool');
        agentMsg._progress = `Running ${action}…`;
        renderList();
      },
      onToolResult: () => {
        agentMsg._progress = '';
        renderList();
      },
      onFinal: (text) => {
        if (text && !agentMsg.content) agentMsg.content = text;
        agentMsg._progress = '';
        renderList();
      },
      onError: (err) => {
        agentMsg.content = agentMsg.content || `Error: ${err?.message || 'stream failed'}`;
        agentMsg._progress = '';
        renderList();
      },
      onDone: async () => {
        agentMsg._progress = '';
        input.disabled = false;
        input.focus();
        // Reconcile with server (in case our local append diverged).
        try {
          const fresh = await loadSubagentChat(agent.id, 80);
          if (Array.isArray(fresh) && fresh.length) {
            messages = fresh;
            renderList();
          }
        } catch {}
      },
    });
    attachStream?.(stream);
  });
}
