// ═══ CHAT PAGE — EXTRACTED to src/pages/ChatPage.js (F3f) ═══
// Sessions, sendChat, renderChatMessages, process log, progress panel,
// agent execution, canvas, file upload (~2,421 lines)


// ─── Global state (shared with modules via window.*) ──────────────────────
const API = '';
let ws = null;
let selectedJobId = null;
let allJobs = [];
let pollInterval = null;
let currentMode = 'chat';
let sidebarTab = 'jobs';
let useAgentMode = true;
const CHAT_SESSIONS_KEY = 'prometheus_chat_sessions_v1';
const AGENT_SESSION_KEY = 'prometheus_agent_session_id';
const THEME_KEY = 'prometheus_theme';
let agentSessionId = '';
let chatHistory = [];
let chatSessions = [];
let activeChatSessionId = null;
let sessionsEditMode = false;
let isThinking = false;
let streamingSessionId = null;
let processLogEntries = [];
let currentTurnStartIndex = -1;
let lastAgentMode = '-';
let lastTurnKind = '-';
let settingsTab = 'system';
let runtimeProgressState = { source: 'none', activeIndex: -1, items: [] };
let quickSearchRigor = 'verified';
let quickThinkingEffort = localStorage.getItem('prometheus_quick_thinking_effort') || 'standard';
let queuedPrompts = [];
const MAX_QUEUED_PROMPTS = 8;
let currentPreflightStatus = '';
let currentProgressLines = [];
let processLogAutoFollow = true;
let rightColumnAutoFollow = true;
let agentExecutionMap = new Map();
let agentIdCounter = 0;
const AGENT_STATUS = { ACTIVE: 'active', COMPLETED: 'completed', PAUSED: 'paused' };
let agentsConfigList = [];
let selectedAgentId = '';
let agentMdEditor = null;
let teamsData = [];  // Populated by TeamsPage.js/refreshTeams(); used by loadAgentsTab() for grouping
let heartbeatEditor = null;
let heartbeatSettingsLoaded = false;
let heartbeatSettingsCache = { enabled: true, interval_minutes: 30, model: '', review_teams_after_run: false, instructions: '', path: '' };
let lastHeartbeat = { state: 'idle', level: '', current_step: '-', retry_count: 0, format_violation_count: 0, message: '' };
let lastHeartbeatLogSignature = '';

// ─── Expose inline globals on window for ES modules ──────────────────────
// Modules (ChatPage.js, etc.) read these via window.*
window.API = API; window.ws = ws; window.selectedJobId = selectedJobId;
window.allJobs = allJobs; window.pollInterval = pollInterval;
window.currentMode = currentMode; window.sidebarTab = sidebarTab;
window.useAgentMode = useAgentMode; window.agentSessionId = agentSessionId;
window.chatHistory = chatHistory; window.chatSessions = chatSessions;
window.activeChatSessionId = activeChatSessionId; window.sessionsEditMode = sessionsEditMode;
window.isThinking = isThinking; window.streamingSessionId = streamingSessionId;
window.processLogEntries = processLogEntries; window.currentTurnStartIndex = currentTurnStartIndex;
window.lastAgentMode = lastAgentMode; window.lastTurnKind = lastTurnKind;
window.settingsTab = settingsTab; window.runtimeProgressState = runtimeProgressState;
window.quickSearchRigor = quickSearchRigor; window.quickThinkingEffort = quickThinkingEffort;
window.queuedPrompts = queuedPrompts; window.currentPreflightStatus = currentPreflightStatus;
window.currentProgressLines = currentProgressLines; window.processLogAutoFollow = processLogAutoFollow;
window.rightColumnAutoFollow = rightColumnAutoFollow; window.agentExecutionMap = agentExecutionMap;
window.agentIdCounter = agentIdCounter; window.agentsConfigList = agentsConfigList;
window.selectedAgentId = selectedAgentId; window.agentMdEditor = agentMdEditor;
window.teamsData = teamsData; window.heartbeatEditor = heartbeatEditor; window.heartbeatSettingsLoaded = heartbeatSettingsLoaded;
window.heartbeatSettingsCache = heartbeatSettingsCache; window.lastHeartbeat = lastHeartbeat;
window.lastHeartbeatLogSignature = lastHeartbeatLogSignature;
window.CHAT_SESSIONS_KEY = CHAT_SESSIONS_KEY; window.AGENT_SESSION_KEY = AGENT_SESSION_KEY;
window.THEME_KEY = THEME_KEY; window.MAX_QUEUED_PROMPTS = MAX_QUEUED_PROMPTS;
window.AGENT_STATUS = AGENT_STATUS;

window.setChatSessionsRef = function(next) {
  chatSessions = Array.isArray(next) ? next : [];
  window.chatSessions = chatSessions;
  return chatSessions;
};

window.getChatSessionsRef = function() {
  return chatSessions;
};

function connectWS() {
  // F5: connectWS is now in ws.js module and dispatches via wsEventBus.
  // This inline version is a thin wrapper that calls the module version.
  if (typeof window.wsEventBus !== 'undefined') {
    // Module ws.js is loaded — use its connectWS
    window.connectWS();
  } else {
    // Fallback: module not loaded yet, retry
    setTimeout(connectWS, 100);
  }
}

// ─── Heartbeat/Settings WS handlers (stay inline until Settings is extracted) ───
(function _registerInlineWsHandlers() {
  function _waitForEventBus() {
	    if (typeof window.wsEventBus === 'undefined') { setTimeout(_waitForEventBus, 100); return; }
	    const bus = window.wsEventBus;

	    bus.on('provider_status', (msg) => {
	      const online = !!msg?.providerOnline;
	      const dot = document.getElementById('ollama-dot');
	      if (dot) dot.className = 'dot ' + (online ? 'online' : 'offline');
	      const statusEl = document.getElementById('ollama-status');
	      if (statusEl) {
	        statusEl.textContent = online ? 'Online' : 'Offline';
	      }
	      const ro = document.getElementById('r-ollama');
	      if (ro) {
	        ro.textContent = online ? 'Online' : 'Offline';
	        ro.className = 'info-val ' + (online ? 'green' : 'red');
	      }
	      if (typeof checkStatus === 'function') setTimeout(() => checkStatus(), 250);
	    });

	    const isHeartbeatOkText = (text) => /^\s*(?:`{1,3}\s*)?heartbeat[\s_-]*ok(?:\s*`{1,3})?\s*[.!]?\s*$/i.test(String(text || ''));

	    bus.on('heartbeat_done', (msg) => {
      if (msg.isOk || isHeartbeatOkText(msg.text)) {
        if (typeof refreshHeartbeatSummary === 'function') refreshHeartbeatSummary().catch(() => {});
        return;
      }
      if (msg.automatedSession && typeof window.upsertAutomatedSession === 'function') {
        window.upsertAutomatedSession(msg.automatedSession);
      }
      if (!msg.isOk) {
        if (typeof window.bgtToast === 'function') window.bgtToast('\u2764 Heartbeat', String(msg.text || 'Heartbeat reported updates').slice(0, 120));
        if (typeof window.addProcessEntry === 'function') window.addProcessEntry('warn', 'Heartbeat reported actionable updates.');
      }
      if (typeof refreshHeartbeatSummary === 'function') refreshHeartbeatSummary().catch(() => {});
    });

    bus.on('heartbeat_result', (msg) => {
      if (msg.isOk || isHeartbeatOkText(msg.text)) return;
      if (typeof window.bgtToast === 'function') window.bgtToast('\u2764 Heartbeat', String(msg.text || 'Actionable heartbeat result').slice(0, 120));
    });

    bus.on('heartbeat_sse', (msg) => {
      if (msg.event === 'tool_call' && msg.data?.action) {
        if (typeof window.addProcessEntry === 'function') window.addProcessEntry('info', '[Heartbeat' + (msg.agentId ? ' → ' + msg.agentId : '') + '] Tool: ' + String(msg.data.action).slice(0, 80));
      }
    });

	    bus.on('heartbeat_agent_config_updated', (msg) => {
	      const hbPanel = document.getElementById('settings-panel-heartbeat');
	      void hbPanel;
	      if (msg.agentId && msg.agentId === window.selectedAgentId) {
        const enabledEl = document.getElementById('agent-hb-enabled');
        const intervalEl = document.getElementById('agent-hb-interval');
        if (enabledEl && msg.config) enabledEl.checked = msg.config.enabled === true;
        if (intervalEl && msg.config) intervalEl.value = String(msg.config.intervalMinutes || 30);
      }
      if (typeof window.addProcessEntry === 'function') window.addProcessEntry('info', 'Heartbeat config updated for "' + (msg.agentId || 'agent') + '" by AI.');
    });

    // ── proposal_created: only refresh right-column if proposal belongs to this session ──
    bus.on('proposal_created', (msg) => {
      // Only refresh right-column if proposal was created in THIS chat session.
      // Background/team proposals (no sessionId) go to Proposals page only.
      const isForThisSession = msg.sessionId && msg.sessionId === window.activeChatSessionId;
      if (isForThisSession && typeof loadSessionApprovals === 'function') {
        loadSessionApprovals();
      }
      // Always bump the nav badge regardless of session origin
      if (typeof checkPendingProposalsBadge === 'function') checkPendingProposalsBadge();
    });
  }
  _waitForEventBus();
})();
// ═══ SETTINGS — EXTRACTED to src/pages/SettingsPage.js ═══
// 98 functions (~2,153 lines) moved

// ---- Sessions list ----
let _sessionSearchQuery = '';
let _sessionSearchResults = [];
let _sessionSearchLoading = false;
let _sessionSearchError = '';
let _sessionSearchTimer = null;
let _sessionSearchSeq = 0;
const SIDEBAR_SESSION_PAGE_SIZE = 20;
let _sessionShowCount = SIDEBAR_SESSION_PAGE_SIZE; // keep the default and Priority views equally bounded
let _settledSessions = [];
let _settledSessionsOffset = 0;
let _settledSessionsHasMore = false;
let _settledSessionsLoading = false;
let _settledViewOpen = false;
let _priorityPanelOpen = false;
let _sidebarSearchOpen = false;
const _priorityCollapsedSections = new Set();
const _priorityCollapsedProjects = new Set();
window.isPriorityProjectCollapsed = (id) => _priorityCollapsedProjects.has(String(id || '').trim());
let _channelsViewOpen = false;
let _activeChannelDrill = null; // null = hub view, 'telegram'|'discord'|'whatsapp'|'terminal' = drilled in
let _channelsEditMode = false;
let _pinnedChats = JSON.parse(localStorage.getItem('prometheus_pinned_chats') || '[]');
const _sidebarBranchMetadata = new Map();
let _sidebarBranchMetadataRequest = null;
let _sidebarBranchMetadataInFlightIds = new Set();

function _isPrioritySession(session) {
  if (!session || typeof session !== 'object') return false;
  if (/^(brain_thought_|brain_dream_|brain_dream_cleanup_|subagent_chat_|task_recovery_|task_resume_brief_)/i.test(String(session.id || ''))) return false;
  return session.settled !== true && Number(session.settledAt || 0) <= 0;
}

function _isSessionWorking(session) {
  const id = String(session?.id || '').trim();
  if (!id) return false;
  const thinkingMap = window._sessionThinking;
  if (thinkingMap && Object.prototype.hasOwnProperty.call(thinkingMap, id)) {
    return thinkingMap[id] === true;
  }
  return session?.activeRun === true;
}

function _isPriorityAttentionSession(session) {
  return _isPrioritySession(session) && (_isSessionWorking(session) || session?.unread === true);
}

function _priorityAttentionSessions() {
  return (window.chatSessions || []).filter(_isPriorityAttentionSession);
}

function syncPriorityBell() {
  const button = document.getElementById('sidebarPriorityToggle');
  const dot = document.getElementById('sidebarUnreadDot');
  const priorityCount = _priorityAttentionSessions().length;
  const hasPriority = priorityCount > 0;
  if (dot) dot.hidden = !hasPriority;
  if (button) {
    button.classList.toggle('has-unread', hasPriority);
    button.setAttribute('aria-label', hasPriority ? `Open priority chats (${priorityCount} priority)` : 'Open priority chats');
    button.title = hasPriority ? `${priorityCount} priority chat${priorityCount === 1 ? '' : 's'}` : 'Priority chats';
  }
}

function toggleSidebarSearch(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const sidebar = document.getElementById('sidebar');
  const search = document.querySelector('.sidebar-search');
  const button = document.getElementById('sidebarSearchToggle');
  if (!sidebar || !search) return;
  _sidebarSearchOpen = !_sidebarSearchOpen;
  sidebar.classList.toggle('sidebar-search-open', _sidebarSearchOpen);
  search.hidden = !_sidebarSearchOpen;
  button?.setAttribute('aria-expanded', String(_sidebarSearchOpen));
  button?.setAttribute('aria-label', _sidebarSearchOpen ? 'Close search' : 'Open search');
  button && (button.title = _sidebarSearchOpen ? 'Close search' : 'Search chats');
  if (_sidebarSearchOpen) setTimeout(() => document.getElementById('session-search')?.focus(), 0);
}

function togglePriorityPanel(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  _priorityPanelOpen = !_priorityPanelOpen;
  const sidebar = document.getElementById('sidebar');
  const button = document.getElementById('sidebarPriorityToggle');
  sidebar?.classList.toggle('priority-panel-open', _priorityPanelOpen);
  button?.setAttribute('aria-expanded', String(_priorityPanelOpen));
  button?.setAttribute('aria-pressed', String(_priorityPanelOpen));
  button?.setAttribute('aria-label', _priorityPanelOpen ? 'Close priority chats' : 'Open priority chats');
  if (_priorityPanelOpen && _settledViewOpen) closeSettledSessionsView();
  renderSessionsList();
}

function togglePrioritySection(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const toggle = event?.currentTarget;
  const section = toggle?.closest?.('[data-priority-section]');
  const key = String(section?.dataset?.prioritySection || '').trim();
  if (!key) return;
  if (_priorityCollapsedSections.has(key)) _priorityCollapsedSections.delete(key);
  else _priorityCollapsedSections.add(key);
  renderSessionsList();
}

function togglePriorityProject(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const title = event?.currentTarget;
  const group = title?.closest?.('[data-priority-project-id]');
  const key = String(group?.dataset?.priorityProjectId || '').trim();
  if (!key) return;
  if (_priorityCollapsedProjects.has(key)) _priorityCollapsedProjects.delete(key);
  else _priorityCollapsedProjects.add(key);
  renderSessionsList();
}

function filterSessions(query) {
  _sessionSearchQuery = (query || '').toLowerCase().trim();
  _sessionShowCount = SIDEBAR_SESSION_PAGE_SIZE;
  requestSessionSearch(query);
  renderSessionsList();
  if (typeof filterSkills === 'function') filterSkills(query);
}

function showMoreSessions() {
  _sessionShowCount += SIDEBAR_SESSION_PAGE_SIZE;
  renderSessionsList();
}

function requestSessionSearch(query) {
  const rawQuery = String(query || '').trim();
  if (_sessionSearchTimer) clearTimeout(_sessionSearchTimer);
  if (!rawQuery) {
    _sessionSearchResults = [];
    _sessionSearchLoading = false;
    _sessionSearchError = '';
    return;
  }
  const seq = ++_sessionSearchSeq;
  _sessionSearchLoading = true;
  _sessionSearchError = '';
  _sessionSearchTimer = setTimeout(async () => {
    try {
      const params = new URLSearchParams({ q: rawQuery, limit: '100', scope: 'all', includeAutomated: '1', state: _settledViewOpen ? 'settled' : 'active' });
      const res = await fetch(`/api/sessions/search?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (seq !== _sessionSearchSeq) return;
      _sessionSearchResults = Array.isArray(data.sessions) ? data.sessions : [];
      _sessionSearchError = '';
    } catch (err) {
      if (seq !== _sessionSearchSeq) return;
      _sessionSearchResults = [];
      _sessionSearchError = 'Session search is unavailable.';
    } finally {
      if (seq === _sessionSearchSeq) {
        _sessionSearchLoading = false;
        renderSessionsList();
      }
    }
  }, 180);
}

// ---- Channel classification ----
const CHANNEL_ICONS = {
  voice_room: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12h2l2-5 3 10 3-8 2 5h4"/><circle cx="12" cy="12" r="10"/></svg>`,
  telegram: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  discord:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/></svg>`,
  whatsapp: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
  terminal: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  mobile:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>`,
};
const CHANNEL_DEFS = [
  { key: 'voice_room', label: 'Voice Rooms', icon: CHANNEL_ICONS.voice_room, color: '#D6B85A', desc: 'Persistent multi-agent voice conversations' },
  { key: 'mobile',    label: 'Mobile',    icon: CHANNEL_ICONS.mobile,    color: '#EA6A1F', desc: 'Chats from the mobile app' },
  { key: 'telegram',  label: 'Telegram',  icon: CHANNEL_ICONS.telegram,  color: '#229ED9', desc: 'Chats via Telegram bot' },
  { key: 'discord',   label: 'Discord',   icon: CHANNEL_ICONS.discord,   color: '#5865F2', desc: 'Chats via Discord bot' },
  { key: 'whatsapp',  label: 'WhatsApp',  icon: CHANNEL_ICONS.whatsapp,  color: '#25D366', desc: 'Chats via WhatsApp' },
  { key: 'terminal',  label: 'CLI',       icon: CHANNEL_ICONS.terminal,  color: '#6B7280', desc: 'Terminal /new sessions' },
];
const IS_PUBLIC_WEB_UI = window.PROMETHEUS_PUBLIC_BUILD === true;
const VISIBLE_CHANNEL_DEFS = IS_PUBLIC_WEB_UI
  ? CHANNEL_DEFS.filter(c => c.key !== 'terminal')
  : CHANNEL_DEFS;

function _getSessionChannel(s) {
  const direct = String(s.channel || '').toLowerCase();
  if (direct === 'telegram') return 'telegram';
  if (direct === 'discord')  return 'discord';
  if (direct === 'whatsapp') return 'whatsapp';
  if (direct === 'terminal') return 'terminal';
  if (direct === 'mobile')   return 'mobile';
  if (direct === 'voice_room') return 'voice_room';
  const src = String(s.source || '').toLowerCase();
  if (src === 'telegram') return 'telegram';
  if (src === 'discord')  return 'discord';
  if (src === 'whatsapp') return 'whatsapp';
  if (src === 'terminal') return 'terminal';
  if (src === 'mobile')   return 'mobile';
  if (src === 'voice_room') return 'voice_room';
  const id = String(s.id || '').toLowerCase();
  if (id.startsWith('telegram_')) return 'telegram';
  if (id.startsWith('discord_')) return 'discord';
  if (id.startsWith('whatsapp_')) return 'whatsapp';
  if (id.startsWith('cli_')) return 'terminal';
  if (id.startsWith('mobile_')) return 'mobile';
  if (id.startsWith('voice_room_')) return 'voice_room';
  if (s.automated) {
    const ch = String((s.history || [])[0]?.channel || '').toLowerCase();
    if (ch === 'telegram') return 'telegram';
    if (ch === 'discord')  return 'discord';
    if (ch === 'whatsapp') return 'whatsapp';
    if (ch === 'terminal') return 'terminal';
    if (ch === 'mobile')   return 'mobile';
  }
  return null;
}

function _isChannelSession(s) {
  return _getSessionChannel(s) !== null;
}

// ---- Toggle channels panel open/closed ----
function toggleChannelsView() {
  _channelsViewOpen = !_channelsViewOpen;
  _activeChannelDrill = null; // always reset to hub on open/close
  _applyChannelsViewState();
}

function _applyChannelsViewState() {
  const jobsList   = document.getElementById('jobs-list');
  const chPanel    = document.getElementById('sidebar-channels');
  const searchBar  = document.getElementById('session-search')?.parentElement;
  const newBtn     = document.getElementById('sessions-new-btn');
  const editBtn    = document.getElementById('sessions-edit-btn');
  const chBtn      = document.getElementById('btn-channels');

  if (_channelsViewOpen) {
    if (jobsList)  jobsList.style.display  = 'none';
    if (chPanel)   chPanel.style.display   = 'flex';
    if (searchBar) searchBar.style.display = 'none';
    if (newBtn)    newBtn.style.display    = 'none';
    if (editBtn)   editBtn.style.display   = 'none';
    if (chBtn) { chBtn.style.background = 'var(--brand)'; chBtn.style.color = '#fff'; chBtn.style.borderColor = 'var(--brand)'; }
    _renderChannelsPanel();
  } else {
    if (jobsList)  jobsList.style.display  = '';
    if (chPanel)   chPanel.style.display   = 'none';
    if (searchBar) searchBar.style.display = '';
    if (newBtn)    newBtn.style.display    = '';
    if (editBtn)   editBtn.style.display   = '';
    if (chBtn) { chBtn.style.background = ''; chBtn.style.color = ''; chBtn.style.borderColor = ''; }
  }
}

// ---- Master render dispatcher ----
function _renderChannelsPanel() {
  if (_activeChannelDrill) {
    _renderChannelDrill(_activeChannelDrill);
  } else {
    _renderChannelHub();
  }
}

// ---- Hub: one card per channel type ----
function _renderChannelHub() {
  const el = document.getElementById('channels-list');
  if (!el) return;

  // Count sessions + unread per channel
  const counts = {};
  const unreads = {};
  VISIBLE_CHANNEL_DEFS.forEach(c => { counts[c.key] = 0; unreads[c.key] = 0; });

  (window.chatSessions || []).forEach(s => {
    const ch = _getSessionChannel(s);
    if (ch && counts[ch] !== undefined) {
      counts[ch]++;
      if (s.unread) unreads[ch]++;
    }
  });
  // Terminal sessions from server (not yet in chatSessions)
  (window.terminalSessions || []).forEach(ts => {
    const alreadyCounted = (window.chatSessions || []).some(s => s.id === ts.id);
    if (!alreadyCounted) counts['terminal']++;
  });
  (window.mobileSessions || []).forEach(ms => {
    const alreadyCounted = (window.chatSessions || []).some(s => s.id === ms.id);
    if (!alreadyCounted) counts['mobile']++;
  });
  ((window.channelSessionsByChannel && window.channelSessionsByChannel.voice_room) || []).forEach(room => {
    const alreadyCounted = (window.chatSessions || []).some(s => s.id === room.id);
    if (!alreadyCounted) counts.voice_room++;
  });
  ['telegram', 'discord', 'whatsapp'].forEach(channelKey => {
    const sourceSessions = (window.channelSessionsByChannel && window.channelSessionsByChannel[channelKey])
      || window[`${channelKey}Sessions`]
      || [];
    sourceSessions.forEach(cs => {
      const alreadyCounted = (window.chatSessions || []).some(s => s.id === cs.id);
      if (!alreadyCounted) counts[channelKey]++;
    });
  });

  el.innerHTML = VISIBLE_CHANNEL_DEFS.map(c => {
    const count   = counts[c.key] || 0;
    const unread  = unreads[c.key] || 0;
    const isEmpty = count === 0;
    return `
<div class="channel-hub-card${isEmpty ? ' channel-hub-card-empty' : ''}" onclick="_drillChannel('${c.key}')">
  <div class="channel-hub-card-icon" style="background:${c.color}22;border-color:${c.color}44;color:${c.color}">${c.icon}</div>
  <div class="channel-hub-card-body">
    <div class="channel-hub-card-name">${c.label}</div>
    <div class="channel-hub-card-desc">${isEmpty ? c.desc : count + ' chat' + (count !== 1 ? 's' : '')}</div>
  </div>
  <div class="channel-hub-card-right">
    ${unread > 0 ? `<span class="channel-hub-unread">${unread}</span>` : ''}
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="color:var(--muted);flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
  </div>
</div>`;
  }).join('');
}

// ---- Drill: sessions for one channel ----
function _drillChannel(channelKey) {
  _activeChannelDrill = channelKey;
  _renderChannelDrill(channelKey);
}

function toggleChannelsEditMode() {
  _channelsEditMode = !_channelsEditMode;
  if (_activeChannelDrill) _renderChannelDrill(_activeChannelDrill);
}

function _renderChannelDrill(channelKey) {
  const el = document.getElementById('channels-list');
  if (!el) return;

  const def = CHANNEL_DEFS.find(c => c.key === channelKey) || { label: channelKey, icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M19.07 4.93l-2.83 2.83M7.76 16.24l-2.83 2.83"/></svg>`, color: '#888' };

  // Collect sessions for this channel
  let sessions = (window.chatSessions || [])
    .filter(s => _getSessionChannel(s) === channelKey)
    .sort((a, b) => getSessionSortTime(b) - getSessionSortTime(a));

  // For server-backed channels: include sessions not yet in chatSessions
  let serverOnly = [];
  if (channelKey === 'terminal' || channelKey === 'mobile' || channelKey === 'voice_room' || channelKey === 'telegram' || channelKey === 'discord' || channelKey === 'whatsapp') {
    const sourceSessions = (window.channelSessionsByChannel && window.channelSessionsByChannel[channelKey])
      || (channelKey === 'mobile' ? (window.mobileSessions || []) : (channelKey === 'terminal' ? (window.terminalSessions || []) : (window[`${channelKey}Sessions`] || [])));
    serverOnly = sourceSessions.filter(
      ts => !sessions.some(s => s.id === ts.id)
    );
  }
  ensureSidebarBranchMetadata([...sessions, ...serverOnly]);

  const backBtn = `
<div class="channel-drill-header">
  <button class="channel-drill-back" onclick="_backToChannelHub()">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
    Channels
  </button>
  <span class="channel-drill-title" style="color:${def.color}">${def.icon} ${def.label}</span>
  <button class="sidebar-action" onclick="toggleChannelsEditMode()" style="margin-left:auto">${_channelsEditMode ? 'Done' : 'Edit'}</button>
</div>`;

  if (!sessions.length && !serverOnly.length) {
    el.innerHTML = backBtn + `<div class="empty-state" style="padding:24px 16px">No ${def.label} chats yet.</div>`;
    return;
  }

  const sortPinnedFirst = (a, b) => {
    const aPinned = _pinnedChats.includes(a.id) ? 1 : 0;
    const bPinned = _pinnedChats.includes(b.id) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return getSessionSortTime(b) - getSessionSortTime(a);
  };
  sessions = sessions.sort(sortPinnedFirst);
  serverOnly = serverOnly.sort(sortPinnedFirst);

  const sessionCards = sessions.map(s => {
    const isActive = s.id === window.activeChatSessionId;
    const isPinned = _pinnedChats.includes(s.id);
    const isWorking = _isSessionWorking(s);
    const unreadDot = s.unread && !isWorking && !_isImportedSession(s)
      ? '<span class="session-unread-dot" title="Unread" aria-label="Unread"></span>'
      : '';
    const channelTimestamp = getSessionLastMessageAt(s) || s.createdAt;
    return `
<div class="job-item chat-session-item channel-chat-item${isActive ? ' active' : ''}${isWorking ? ' is-working' : ''}${s.unread && !isWorking ? ' unread' : ''}${isPinned ? ' pinned-chat' : ''}${_channelsEditMode ? ' is-editing' : ''}${_isImportedSession(s) ? ' imported-session-card' : ''}" data-session-hover-preview data-session-id="${escHtml(s.id)}" data-session-channel="${escHtml(channelKey)}" data-session-title="${escHtml(s.title || 'Untitled')}" draggable="true" ondragstart="beginSidebarSessionDrag(event)" ondragover="allowSidebarSessionDrop(event)" ondragleave="leaveSidebarSessionDrop(event)" ondrop="dropSidebarSession(event)" ondragend="endSidebarSessionDrag()" onpointerenter="queueSessionHoverPreview(this)" onpointerleave="scheduleSessionHoverPreviewClose()" onclick="if (consumeSidebarClick(event)) return; openSession('${s.id}')">
   ${renderImportedSourceMeta(s, channelTimestamp)}
   ${_channelsEditMode ? renderSessionEditActions(s.id, isPinned) : `<button class="chat-session-action-btn chat-pin-btn${isPinned ? ' active' : ''}" onclick="toggleChatPin('${s.id}', event)" title="${isPinned ? 'Unpin' : 'Pin'} chat" aria-label="${isPinned ? 'Unpin' : 'Pin'} chat">${SKILL_STAR_ICON(isPinned)}</button>`}
  <div class="job-item-head job-item-head--pinned">
    <div class="job-item-title-wrap">
      ${unreadDot}
      ${renderImportedSourceLogo(s)}
      <div class="job-item-title">${escHtml(s.title || 'Untitled')}</div>
    </div>
  </div>
   <div class="job-item-meta">
     ${isPinned ? `<span class="badge badge-queued">Channel: ${escHtml(def.label)}</span>` : ''}
     ${isWorking ? '<span class="session-working-badge">Working</span>' : ''}
   </div>
</div>`;
  }).join('');

  const serverCards = serverOnly.map(s => {
    const isActive = s.id === window.activeChatSessionId;
    const isPinned = _pinnedChats.includes(s.id);
    const isWorking = _isSessionWorking(s);
    const serverTimestamp = getSessionLastMessageAt(s) || s.lastActiveAt || s.createdAt;
    const unreadDot = s.unread && !isWorking && !_isImportedSession(s)
      ? '<span class="session-unread-dot" title="Unread" aria-label="Unread"></span>'
      : '';
  const title = escHtml(s.title || s.preview || s.id.slice(0, 20));
    const roster = Array.isArray(s.voiceRoom?.participants)
      ? s.voiceRoom.participants.map((participant) => participant.label).filter(Boolean).join(' · ')
      : '';
    return `
<div class="job-item chat-session-item channel-chat-item${isActive ? ' active' : ''}${isWorking ? ' is-working' : ''}${s.unread && !isWorking ? ' unread' : ''}${isPinned ? ' pinned-chat' : ''}${_channelsEditMode ? ' is-editing' : ''}${_isImportedSession(s) ? ' imported-session-card' : ''} session-terminal" data-session-hover-preview data-session-id="${escHtml(s.id)}" data-session-channel="${escHtml(channelKey)}" data-session-title="${title}" draggable="true" ondragstart="beginSidebarSessionDrag(event)" ondragover="allowSidebarSessionDrop(event)" ondragleave="leaveSidebarSessionDrop(event)" ondrop="dropSidebarSession(event)" ondragend="endSidebarSessionDrag()" onpointerenter="queueSessionHoverPreview(this)" onpointerleave="scheduleSessionHoverPreviewClose()" onclick="if (consumeSidebarClick(event)) return; openTerminalSession('${s.id}', '${channelKey}')">
   ${renderImportedSourceMeta(s, serverTimestamp)}
   ${_channelsEditMode ? renderSessionEditActions(s.id, isPinned) : `<button class="chat-session-action-btn chat-pin-btn${isPinned ? ' active' : ''}" onclick="toggleChatPin('${s.id}', event)" title="${isPinned ? 'Unpin' : 'Pin'} chat" aria-label="${isPinned ? 'Unpin' : 'Pin'} chat">${SKILL_STAR_ICON(isPinned)}</button>`}
  <div class="job-item-head job-item-head--pinned">
    <div class="job-item-title-wrap">
      ${unreadDot}
      ${renderImportedSourceLogo(s)}
      <div class="job-item-title">${title}</div>
      ${roster ? `<div class="job-item-subtitle">${escHtml(roster)}</div>` : ''}
    </div>
  </div>
   <div class="job-item-meta">
     ${isPinned ? `<span class="badge badge-queued">Channel: ${escHtml(def.label)}</span>` : ''}
     ${isWorking ? '<span class="session-working-badge">Working</span>' : ''}
   </div>
</div>`;
  }).join('');

  el.innerHTML = backBtn + sessionCards + serverCards;
}

function _backToChannelHub() {
  _activeChannelDrill = null;
  _channelsEditMode = false;
  _renderChannelHub();
}

let _sessionHoverPreviewCloseTimer = null;
let _sidebarBranchPopoverCloseTimer = null;

function _sidebarInlineBranchMetadata(session) {
  const github = session?.canvasProjectLink?.github;
  // Persisted Canvas branch labels are useful as a name hint, but the branch
  // itself must come from the current workspace lookup so checkout changes do
  // not leave a stale sidebar indicator behind.
  const branch = String(session?.branch || session?.workspaceBranch || '').trim();
  if (!branch) return null;
  return {
    branch,
    projectName: String(session?.projectName || session?.canvasProjectLabel || '').trim(),
    repositoryName: String(github?.repoFullName || '').trim(),
  };
}

function _sidebarBranchMetadataForSession(session) {
  const inline = _sidebarInlineBranchMetadata(session);
  if (inline) return inline;
  const id = String(session?.id || '').trim();
  return id && _sidebarBranchMetadata.has(id) ? _sidebarBranchMetadata.get(id) : null;
}

function ensureSidebarBranchMetadata(sessions = []) {
  const candidates = Array.from(new Map(
    (Array.isArray(sessions) ? sessions : [])
      .filter((session) => session && String(session.id || '').trim())
      .map((session) => [String(session.id).trim(), session]),
  ).values());
  const missing = candidates
    .map((session) => String(session.id).trim())
    .filter((id) => !_sidebarBranchMetadata.has(id) && !_sidebarBranchMetadataInFlightIds.has(id))
    .slice(0, 80);
  if (!missing.length || _sidebarBranchMetadataRequest) return;
  _sidebarBranchMetadataInFlightIds = new Set(missing);
  const params = new URLSearchParams({ sessionIds: missing.join(',') });
  _sidebarBranchMetadataRequest = fetch(`/api/coding/session-metadata?${params.toString()}`)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      const returned = new Set();
      (Array.isArray(data?.sessions) ? data.sessions : []).forEach((item) => {
        const id = String(item?.sessionId || '').trim();
        if (!id) return;
        returned.add(id);
        _sidebarBranchMetadata.set(id, item?.connected === true && String(item?.branch || '').trim()
          ? item
          : null);
      });
      missing.forEach((id) => {
        if (!returned.has(id)) _sidebarBranchMetadata.set(id, null);
      });
      scheduleSessionListRefresh();
      window.renderProjectsList?.();
    })
    .catch(() => {})
    .finally(() => {
      _sidebarBranchMetadataRequest = null;
      _sidebarBranchMetadataInFlightIds.clear();
    });
}

function renderSidebarBranchIndicator(session, placement = 'default') {
  const metadata = _sidebarBranchMetadataForSession(session);
  const branch = String(metadata?.branch || '').trim();
  if (!branch) return '';
  const projectName = String(metadata?.projectName || metadata?.repositoryName || session?.projectName || session?.canvasProjectLabel || 'Workspace').trim();
  const label = `Working on ${projectName}, branch ${branch}`;
  return `<span class="sidebar-branch-indicator sidebar-branch-indicator--${placement}" tabindex="0" role="img" aria-label="${escHtml(label)}" title="${escHtml(label)}" data-branch-name="${escHtml(branch)}" data-branch-project="${escHtml(projectName)}" onpointerenter="showSidebarBranchPopover(this)" onpointerleave="scheduleSidebarBranchPopoverClose()" onfocus="showSidebarBranchPopover(this)" onblur="scheduleSidebarBranchPopoverClose()" onclick="event.preventDefault();event.stopPropagation()"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="2.25"></circle><circle cx="18" cy="19" r="2.25"></circle><circle cx="18" cy="5" r="2.25"></circle><path d="M6 7.25v5.25a4.5 4.5 0 0 0 4.5 4.5H18M6 7.25v1.5A4.5 4.5 0 0 0 10.5 13H18V7.25"></path></svg></span>`;
}
window.ensureSidebarBranchMetadata = ensureSidebarBranchMetadata;

function _getSidebarBranchPopover() {
  let popover = document.getElementById('sidebar-branch-popover');
  if (popover) return popover;
  popover = document.createElement('div');
  popover.id = 'sidebar-branch-popover';
  popover.className = 'sidebar-branch-popover';
  popover.setAttribute('role', 'tooltip');
  popover.addEventListener('pointerenter', () => {
    if (_sidebarBranchPopoverCloseTimer) clearTimeout(_sidebarBranchPopoverCloseTimer);
    _sidebarBranchPopoverCloseTimer = null;
  });
  popover.addEventListener('pointerleave', scheduleSidebarBranchPopoverClose);
  document.body.appendChild(popover);
  return popover;
}

function scheduleSidebarBranchPopoverClose() {
  if (_sidebarBranchPopoverCloseTimer) clearTimeout(_sidebarBranchPopoverCloseTimer);
  _sidebarBranchPopoverCloseTimer = setTimeout(hideSidebarBranchPopover, 280);
}

function hideSidebarBranchPopover() {
  if (_sidebarBranchPopoverCloseTimer) clearTimeout(_sidebarBranchPopoverCloseTimer);
  _sidebarBranchPopoverCloseTimer = null;
  const popover = document.getElementById('sidebar-branch-popover');
  if (popover) {
    popover.classList.remove('is-visible');
    popover.setAttribute('aria-hidden', 'true');
  }
}

function showSidebarBranchPopover(source) {
  if (!source?.isConnected) return;
  if (_sidebarBranchPopoverCloseTimer) clearTimeout(_sidebarBranchPopoverCloseTimer);
  _sidebarBranchPopoverCloseTimer = null;
  hideSessionHoverPreview();
  const branch = String(source.dataset.branchName || '').trim();
  const project = String(source.dataset.branchProject || 'Workspace').trim() || 'Workspace';
  if (!branch) return;
  const popover = _getSidebarBranchPopover();
  popover.innerHTML = `<span class="sidebar-branch-popover-title">${escHtml(project)}</span><span class="sidebar-branch-popover-branch">${escHtml(branch)}</span>`;
  popover.setAttribute('aria-hidden', 'false');
  popover.classList.add('is-visible');
  const rect = source.getBoundingClientRect();
  const preferredWidth = 220;
  const left = Math.min(rect.right + 8, Math.max(8, window.innerWidth - preferredWidth - 12));
  const width = Math.min(preferredWidth, Math.max(160, window.innerWidth - left - 12));
  const top = Math.max(8, Math.min(rect.top - 6, window.innerHeight - 72));
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.width = `${width}px`;
}
let _sessionHoverPreviewSource = null;
let _sessionHoverPreviewEditing = false;

function _sessionById(id) {
  const collections = [
    window.chatSessions,
    window.terminalSessions,
    window.mobileSessions,
    window.telegramSessions,
    window.discordSessions,
    window.whatsappSessions,
    _settledSessions,
    ...(window.channelSessionsByChannel ? Object.values(window.channelSessionsByChannel) : []),
  ];
  return collections.flat().find((session) => session && String(session.id) === String(id)) || null;
}

function _getSessionHoverPreview() {
  let popover = document.getElementById('session-hover-preview');
  if (popover) return popover;
  popover = document.createElement('div');
  popover.id = 'session-hover-preview';
  popover.className = 'session-hover-preview';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Rename chat');
  popover.addEventListener('pointerenter', () => {
    if (_sessionHoverPreviewCloseTimer) clearTimeout(_sessionHoverPreviewCloseTimer);
    _sessionHoverPreviewCloseTimer = null;
  });
  // Pointer-down is earlier than click. Clearing here prevents the short
  // source-to-popover hover gap from closing the editor before it can focus.
  popover.addEventListener('pointerdown', () => {
    if (_sessionHoverPreviewCloseTimer) clearTimeout(_sessionHoverPreviewCloseTimer);
    _sessionHoverPreviewCloseTimer = null;
  });
  popover.addEventListener('pointerleave', scheduleSessionHoverPreviewClose);
  document.body.appendChild(popover);
  return popover;
}

function queueSessionHoverPreview(source) {
  if (!source || source.classList.contains('is-editing') || _sessionHoverPreviewEditing || window.matchMedia('(max-width: 900px)').matches) return;
  if (_sessionHoverPreviewCloseTimer) clearTimeout(_sessionHoverPreviewCloseTimer);
  _sessionHoverPreviewCloseTimer = null;
  if (_sessionHoverPreviewSource === source && document.getElementById('session-hover-preview')?.classList.contains('is-visible')) return;
  const popover = document.getElementById('session-hover-preview');
  if (_sessionHoverPreviewSource && _sessionHoverPreviewSource !== source && popover?.classList.contains('is-visible')) {
    hideSessionHoverPreview();
  }
  showSessionHoverPreview(source);
}

function scheduleSessionHoverPreviewClose() {
  if (_sessionHoverPreviewEditing) return;
  if (_sessionHoverPreviewCloseTimer) clearTimeout(_sessionHoverPreviewCloseTimer);
  _sessionHoverPreviewCloseTimer = setTimeout(hideSessionHoverPreview, 1500);
}

function hideSessionHoverPreview() {
  if (_sessionHoverPreviewEditing) return;
  if (_sessionHoverPreviewCloseTimer) clearTimeout(_sessionHoverPreviewCloseTimer);
  _sessionHoverPreviewCloseTimer = null;
  _sessionHoverPreviewSource = null;
  const popover = document.getElementById('session-hover-preview');
  if (popover) popover.classList.remove('is-visible');
}

function _renderSessionHoverPreviewTitle(popover, id, title) {
  popover.dataset.sessionId = id;
  popover.dataset.sessionTitle = title;
  const session = _sessionById(id);
  const isSettled = session?.settled === true || Number(session?.settledAt || 0) > 0;
  popover.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'session-hover-preview-row';
  const titleButton = document.createElement('button');
  titleButton.type = 'button';
  titleButton.className = 'session-hover-preview-title';
  titleButton.textContent = title;
  titleButton.title = 'Rename chat';
  titleButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    beginSessionHoverRename(popover);
  });
  const optionsButton = document.createElement('button');
  optionsButton.type = 'button';
  optionsButton.className = 'session-hover-preview-options-trigger';
  optionsButton.title = 'Chat options';
  optionsButton.setAttribute('aria-label', 'Chat options');
  optionsButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>';
  const options = document.createElement('div');
  options.className = 'session-hover-preview-options';
  options.hidden = true;
  options.setAttribute('role', 'menu');
  const settleButton = document.createElement('button');
  settleButton.type = 'button';
  settleButton.className = 'session-hover-preview-option';
  settleButton.textContent = isSettled ? 'Unsettle chat' : 'Settle chat';
  settleButton.setAttribute('role', 'menuitem');
  settleButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isSettled) confirmSessionHoverUnsettle(id, title);
    else confirmSessionHoverSettle(id, title);
  });
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'session-hover-preview-option danger';
  deleteButton.textContent = 'Delete permanently';
  deleteButton.setAttribute('role', 'menuitem');
  deleteButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    confirmSessionHoverDelete(id, title);
  });
  options.append(settleButton, deleteButton);
  optionsButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    options.hidden = !options.hidden;
    optionsButton.setAttribute('aria-expanded', String(!options.hidden));
  });
  row.append(titleButton, optionsButton);
  popover.append(row, options);
}

function confirmSessionHoverDelete(id, title) {
  const sessionId = String(id || '').trim();
  if (!sessionId) return;
  const remove = async () => {
    hideSessionHoverPreview();
    if (typeof window.deleteChatSession !== 'function') {
      window.showToast?.('Delete unavailable', 'Chat deletion has not loaded yet.', 'error');
      return;
    }
    await window.deleteChatSession(sessionId);
  };
  const message = `Delete “${title || 'this chat'}”? This permanently deletes the chat and its history. It cannot be undone.`;
  if (typeof window.showConfirm === 'function') {
    window.showConfirm(message, remove, null, {
      title: 'Delete chat permanently?',
      confirmText: 'Delete chat',
      cancelText: 'Keep chat',
      danger: true,
    });
    return;
  }
  if (window.confirm(message)) remove();
}

function confirmSessionHoverSettle(id, title) {
  const sessionId = String(id || '').trim();
  if (!sessionId) return;
  const session = _sessionById(sessionId);
  const submit = async (confirmPinned = false) => {
    hideSessionHoverPreview();
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmPinned }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const blockers = Array.isArray(data?.blockers) ? data.blockers.map(item => item?.message).filter(Boolean).join(' ') : '';
        throw new Error(blockers || data?.error || `HTTP ${response.status}`);
      }
      if (session) {
        session.settledAt = data?.session?.settledAt || Date.now();
        session.settled = true;
      }
      renderSessionsList();
      if (typeof showToast === 'function') showToast('Chat settled', 'It is still saved and available below Show More.', 'success');
    } catch (error) {
      if (typeof showToast === 'function') showToast('Could not settle chat', error?.message || 'The chat is still active.', 'error');
    }
  };
  const pinned = !!(session?.pinnedAt || _pinnedChats.includes(sessionId));
  if (!pinned) {
    submit(false);
    return;
  }
  const message = `Settle “${title || 'this chat'}”? It is pinned and will move out of the normal sidebar. Its history will be kept.`;
  if (typeof window.showConfirm === 'function') {
    window.showConfirm(message, () => submit(true), null, {
      title: 'Settle pinned chat?',
      confirmText: 'Settle chat',
      cancelText: 'Keep chat',
    });
    return;
  }
  if (window.confirm(message)) submit(true);
}

async function confirmSessionHoverUnsettle(id) {
  const sessionId = String(id || '').trim();
  if (!sessionId) return;
  hideSessionHoverPreview();
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/unsettle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    const session = _sessionById(sessionId);
    if (session) {
      session.settledAt = null;
      session.settled = false;
    }
    _settledSessions = (_settledSessions || []).filter(item => String(item.id) !== sessionId);
    renderSessionsList();
    if (typeof showToast === 'function') showToast('Chat reopened', 'It is back in the normal sidebar.', 'success');
  } catch (error) {
    if (typeof showToast === 'function') showToast('Could not reopen chat', error?.message || 'Please try again.', 'error');
  }
}

function showSessionHoverPreview(source) {
  if (!source?.isConnected || source.classList.contains('is-editing')) return;
  const id = String(source.dataset.sessionId || '').trim();
  if (!id) return;
  const session = _sessionById(id);
  const title = String(session?.title || source.dataset.sessionTitle || 'New chat').trim() || 'New chat';
  const popover = _getSessionHoverPreview();
  if (_sessionHoverPreviewCloseTimer) clearTimeout(_sessionHoverPreviewCloseTimer);
  _sessionHoverPreviewCloseTimer = null;
  _sessionHoverPreviewSource = source;
  _renderSessionHoverPreviewTitle(popover, id, title);
  popover.classList.add('is-visible');

  const rect = source.getBoundingClientRect();
  const preferredWidth = 190; // matches the compact More menu
  const left = Math.min(rect.right + 8, Math.max(8, window.innerWidth - preferredWidth - 12));
  const width = Math.min(preferredWidth, Math.max(160, window.innerWidth - left - 12));
  const top = Math.max(8, Math.min(rect.top + (rect.height / 2) - 27, window.innerHeight - 66));
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.width = `${width}px`;
}

function beginSessionHoverRename(popover) {
  if (!popover?.classList.contains('is-visible')) return;
  _sessionHoverPreviewEditing = true;
  if (_sessionHoverPreviewCloseTimer) clearTimeout(_sessionHoverPreviewCloseTimer);
  _sessionHoverPreviewCloseTimer = null;
  const title = String(popover.dataset.sessionTitle || 'New chat');
  popover.innerHTML = '';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'session-hover-preview-input';
  input.value = title;
  input.setAttribute('aria-label', 'Chat title');
  input.addEventListener('keydown', async (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      _sessionHoverPreviewEditing = false;
      _renderSessionHoverPreviewTitle(popover, popover.dataset.sessionId, title);
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const nextTitle = String(input.value || '').replace(/\s+/g, ' ').trim();
    if (!nextTitle || nextTitle === title) {
      _sessionHoverPreviewEditing = false;
      _renderSessionHoverPreviewTitle(popover, popover.dataset.sessionId, title);
      return;
    }
    input.disabled = true;
    try {
      const savedTitle = await saveChatSessionTitle(popover.dataset.sessionId, nextTitle);
      _sessionHoverPreviewEditing = false;
      _renderSessionHoverPreviewTitle(popover, popover.dataset.sessionId, savedTitle);
    } catch {
      _sessionHoverPreviewEditing = false;
      _renderSessionHoverPreviewTitle(popover, popover.dataset.sessionId, title);
    }
  });
  input.addEventListener('blur', () => {
    if (input.disabled) return;
    _sessionHoverPreviewEditing = false;
    _renderSessionHoverPreviewTitle(popover, popover.dataset.sessionId, title);
    requestAnimationFrame(() => {
      if (!popover.matches(':hover') && !_sessionHoverPreviewSource?.matches(':hover')) {
        scheduleSessionHoverPreviewClose();
      }
    });
  }, { once: true });
  popover.appendChild(input);
  input.focus();
  input.select();
}

window.addEventListener('resize', hideSessionHoverPreview);
window.addEventListener('scroll', hideSessionHoverPreview, true);
window.addEventListener('resize', hideSidebarBranchPopover);
window.addEventListener('scroll', hideSidebarBranchPopover, true);

async function toggleChatPin(id, ev) {
  if (ev) ev.stopPropagation();
  const idx = _pinnedChats.indexOf(id);
  const shouldPin = idx === -1;
  if (shouldPin) _pinnedChats.push(id);
  else _pinnedChats.splice(idx, 1);
  localStorage.setItem('prometheus_pinned_chats', JSON.stringify(_pinnedChats));
  renderSessionsList();
  if (_channelsViewOpen) renderChannelsList();
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: shouldPin }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const session = (window.chatSessions || []).find(item => String(item.id) === String(id));
    if (session) session.pinnedAt = data?.session?.pinnedAt || null;
  } catch (err) {
    const currentIdx = _pinnedChats.indexOf(id);
    if (shouldPin && currentIdx !== -1) _pinnedChats.splice(currentIdx, 1);
    if (!shouldPin && currentIdx === -1) _pinnedChats.push(id);
    localStorage.setItem('prometheus_pinned_chats', JSON.stringify(_pinnedChats));
    renderSessionsList();
    if (_channelsViewOpen) renderChannelsList();
    if (typeof showToast === 'function') showToast('Could not update this pin', 'error');
  }
}

function renderSessionEditActions(id, isPinned) {
  return `
    <button class="chat-session-action-btn chat-session-rename-btn" onclick="renameChatSession('${id}', event)" title="Rename chat" aria-label="Rename chat">${SKILL_EDIT_ICON}</button>
    <button class="chat-session-action-btn chat-session-delete-btn" onclick="deleteChatSession('${id}', event)" title="Delete chat" aria-label="Delete chat">${SKILL_DEL_ICON}</button>
    <button class="chat-session-action-btn chat-pin-btn${isPinned ? ' active' : ''}" onclick="toggleChatPin('${id}', event)" title="${isPinned ? 'Unpin' : 'Pin'} chat" aria-label="${isPinned ? 'Unpin' : 'Pin'} chat">${SKILL_STAR_ICON(isPinned)}</button>
  `;
}

function updateSessionTitleEverywhere(id, title) {
  const apply = (session) => {
    if (!session || String(session.id) !== String(id)) return false;
    session.title = title;
    session.autoTitleLocked = true;
    session.updatedAt = Date.now();
    session.lastActiveAt = session.lastActiveAt || session.updatedAt;
    return true;
  };
  let changed = false;
  (window.chatSessions || []).forEach((session) => { changed = apply(session) || changed; });
  (window.terminalSessions || []).forEach((session) => { changed = apply(session) || changed; });
  (window.mobileSessions || []).forEach((session) => { changed = apply(session) || changed; });
  ['telegramSessions', 'discordSessions', 'whatsappSessions'].forEach((key) => {
    (window[key] || []).forEach((session) => { changed = apply(session) || changed; });
  });
  if (window.channelSessionsByChannel && typeof window.channelSessionsByChannel === 'object') {
    Object.values(window.channelSessionsByChannel).forEach((list) => {
      (Array.isArray(list) ? list : []).forEach((session) => { changed = apply(session) || changed; });
    });
  }
  return changed;
}

async function saveChatSessionTitle(id, title) {
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
  if (!cleanTitle) throw new Error('A chat title is required');
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: cleanTitle }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `HTTP ${res.status}`);
    }
    const data = await res.json().catch(() => ({}));
    const savedTitle = String(data?.session?.title || cleanTitle).trim() || cleanTitle;
    updateSessionTitleEverywhere(id, savedTitle);
    saveChatSessions();
    renderSessionsList();
    if (_channelsViewOpen) renderChannelsList();
    if (typeof showToast === 'function') showToast('Session renamed', savedTitle, 'success');
    return savedTitle;
  } catch (err) {
    if (typeof showToast === 'function') showToast('Rename failed', err.message || 'Could not rename session', 'error');
    throw err;
  }
}

async function renameChatSession(id, ev) {
  if (ev) ev.stopPropagation();
  const existing = _sessionById(id);
  const current = String(existing?.title || existing?.preview || '').trim();
  const next = window.prompt('Rename chat session', current || 'New chat');
  if (next == null) return;
  const title = String(next || '').replace(/\s+/g, ' ').trim();
  if (!title) return;
  try {
    await saveChatSessionTitle(id, title);
  } catch (err) {
    if (typeof showToast !== 'function') alert(`Rename failed: ${err.message || err}`);
  }
}

function _getSessionChannelLabel(s) {
  const ch = _getSessionChannel(s);
  const def = CHANNEL_DEFS.find(c => c.key === ch);
  return def ? def.label : (ch || '');
}

function _getSessionOriginLabel(s) {
  const origin = s?.lastOrigin && typeof s.lastOrigin === 'object' ? s.lastOrigin : null;
  const raw = String(origin?.label || '').trim();
  if (raw) return raw;
  const channel = String(origin?.channel || s?.channel || s?.source || '').trim().toLowerCase();
  if (channel === 'web') return 'Desktop';
  if (channel === 'mobile') return 'Mobile';
  return _getSessionChannelLabel({ ...s, channel }) || '';
}

const IMPORTED_SOURCE_BRANDS = Object.freeze({
  chatgpt: { key: 'chatgpt', label: 'ChatGPT', asset: '/static/assets/import-sources/chatgpt.svg' },
  'chatgpt-export': { key: 'chatgpt', label: 'ChatGPT', asset: '/static/assets/import-sources/chatgpt.svg' },
  openai: { key: 'openai', label: 'OpenAI', asset: '/static/assets/import-sources/openai.svg' },
  openai_codex: { key: 'openai', label: 'OpenAI', asset: '/static/assets/import-sources/openai.svg' },
  codex: { key: 'openai', label: 'OpenAI', asset: '/static/assets/import-sources/openai.svg' },
  'codex-local': { key: 'openai', label: 'OpenAI', asset: '/static/assets/import-sources/openai.svg' },
  claude: { key: 'claude', label: 'Claude', asset: '/static/assets/import-sources/claude.svg' },
  anthropic: { key: 'claude', label: 'Claude', asset: '/static/assets/import-sources/claude.svg' },
  'claude-code': { key: 'claude', label: 'Claude', asset: '/static/assets/import-sources/claude.svg' },
  'claude-code-local': { key: 'claude', label: 'Claude', asset: '/static/assets/import-sources/claude.svg' },
  cursor: { key: 'cursor', label: 'Cursor', asset: '/static/assets/import-sources/cursor.svg' },
  'cursor-local': { key: 'cursor', label: 'Cursor', asset: '/static/assets/import-sources/cursor.svg' },
  hermes: { key: 'hermes', label: 'Hermes', asset: '/static/assets/import-sources/nous-research.png' },
  'hermes-local': { key: 'hermes', label: 'Hermes', asset: '/static/assets/import-sources/nous-research.png' },
  openclaw: { key: 'openclaw', label: 'OpenClaw', asset: '/static/assets/import-sources/openclaw.svg' },
  'openclaw-local': { key: 'openclaw', label: 'OpenClaw', asset: '/static/assets/import-sources/openclaw.svg' },
});

function _getImportedSourceBrand(session) {
  const imported = session?.externalImport;
  if (!imported || typeof imported !== 'object') return null;
  const source = imported.source && typeof imported.source === 'object' ? imported.source : {};
  const candidates = [source.provider, source.adapter, source.sourceLabel]
    .map(value => String(value || '').trim().toLowerCase())
    .flatMap(value => [value, value.replace(/\s+/g, '-'), value.replace(/[^a-z0-9]+/g, '-')])
    .filter(Boolean);
  for (const candidate of candidates) {
    if (IMPORTED_SOURCE_BRANDS[candidate]) return IMPORTED_SOURCE_BRANDS[candidate];
  }
  return null;
}

function _isImportedSession(session) {
  return !!(session?.externalImport && typeof session.externalImport === 'object');
}

function renderImportedSourceLogo(session) {
  const imported = session?.externalImport;
  if (!imported || typeof imported !== 'object') return '';
  const brand = _getImportedSourceBrand(session);
  const source = imported.source && typeof imported.source === 'object' ? imported.source : {};
  const sourceLabel = brand?.label || String(source.sourceLabel || source.provider || source.adapter || 'source').trim().slice(0, 80) || 'source';
  const ariaLabel = `Imported from ${sourceLabel}`;
  if (!brand) {
    return `<span class="imported-source-logo imported-source-logo--fallback" title="${escHtml(ariaLabel)}" aria-label="${escHtml(ariaLabel)}" role="img"></span>`;
  }
  return `<img class="imported-source-logo imported-source-logo--${brand.key}" data-imported-source="${brand.key}" src="${brand.asset}" alt="${escHtml(ariaLabel)}" width="26" height="26" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="imported-source-logo-fallback" hidden title="${escHtml(ariaLabel)}" aria-label="${escHtml(ariaLabel)}" role="img"></span>`;
}

function renderImportedSourceMeta(session, normalTimestamp) {
  const branch = renderSidebarBranchIndicator(session, 'default');
  return `<span class="chat-session-top-meta">${branch}<span class="chat-session-top-time" title="Last activity">${timeAgo(normalTimestamp ?? (getSessionLastMessageAt(session) || session?.createdAt))}</span></span>`;
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSessionSearchResult(sessionId) {
  if (!_sessionSearchQuery || !Array.isArray(_sessionSearchResults)) return null;
  return _sessionSearchResults.find(r => String(r.id) === String(sessionId)) || null;
}

function sessionFromSearchResult(result) {
  if (!result || !result.id) return null;
  const existing = (window.chatSessions || []).find(s => String(s.id) === String(result.id));
  const sessionId = String(result.id);
  const thinkingMap = window._sessionThinking;
  const hasLocalThinkingState = thinkingMap && Object.prototype.hasOwnProperty.call(thinkingMap, sessionId);
  return {
    ...(existing || {}),
    id: result.id,
    title: result.title || existing?.title || result.preview || 'New chat',
    history: Array.isArray(existing?.history) ? existing.history : [],
    createdAt: result.createdAt || existing?.createdAt || Date.now(),
    updatedAt: result.lastActiveAt || result.updatedAt || existing?.updatedAt || existing?.createdAt || Date.now(),
    lastMessageAt: result.lastMessageAt || existing?.lastMessageAt || 0,
    source: existing?.source || result.channel || '',
    channel: existing?.channel || result.channel || '',
    projectId: result.projectId || existing?.projectId || '',
    projectName: result.projectName || existing?.projectName || '',
    settledAt: result.settledAt || existing?.settledAt || null,
    settled: result.settled === true || existing?.settled === true || Number(result.settledAt || existing?.settledAt || 0) > 0,
    activeRun: hasLocalThinkingState ? thinkingMap[sessionId] === true : result.activeRun === true,
    _searchOnly: !existing,
    _needsServerLoad: !existing,
  };
}

function openSearchSession(id) {
  const sid = String(id || '').trim();
  if (!sid) return;
  let sess = (window.chatSessions || []).find(s => String(s.id) === sid);
  if (!sess) {
    const result = getSessionSearchResult(sid);
    sess = sessionFromSearchResult(result);
    if (sess) {
      window.chatSessions = Array.isArray(window.chatSessions) ? window.chatSessions : [];
      window.chatSessions.unshift(sess);
    }
  }
  openSession(sid);
}

function makeHighlightedSearchSnippet(content, matchedIndex, query, maxLen = 168) {
  const raw = String(content || '').replace(/\s+/g, ' ').trim();
  const q = String(query || '').trim();
  if (!raw || !q) return '';
  const lower = raw.toLowerCase();
  const index = Number.isFinite(Number(matchedIndex)) && Number(matchedIndex) >= 0
    ? Number(matchedIndex)
    : lower.indexOf(q.toLowerCase());
  const safeIndex = index >= 0 ? index : 0;
  const half = Math.floor(maxLen / 2);
  let start = Math.max(0, safeIndex - half);
  let end = Math.min(raw.length, start + maxLen);
  if (end - start < maxLen) start = Math.max(0, end - maxLen);
  let snippet = raw.slice(start, end).trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < raw.length) snippet += '...';
  const escaped = escHtml(snippet);
  const re = new RegExp(`(${escapeRegExp(q)})`, 'ig');
  return escaped.replace(re, '<mark class="session-search-highlight">$1</mark>');
}

function renderSessionSearchPreview(s) {
  if (!_sessionSearchQuery) return '';
  const result = getSessionSearchResult(s.id);
  const fallbackMessage = (s.history || []).find(m => String(m?.content || '').toLowerCase().includes(_sessionSearchQuery));
  const content = result?.matchedContent || fallbackMessage?.content || '';
  if (!content) return '';
  const role = result?.matchedRole || fallbackMessage?.role || '';
  const label = role === 'assistant' ? 'Prom' : role === 'user' ? 'You' : 'Match';
  const index = Number.isFinite(Number(result?.matchedIndex)) ? Number(result.matchedIndex) : -1;
  return `<div class="session-search-preview"><span>${escHtml(label)}:</span> ${makeHighlightedSearchSnippet(content, index, _sessionSearchQuery)}</div>`;
}

function getChatMessageTimestamp(msg) {
  const ts = Number(msg?.timestamp || 0);
  return Number.isFinite(ts) && ts > 0 ? ts : 0;
}

function getSessionLastMessageAt(s) {
  const explicit = Number(s?.lastMessageAt || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const history = Array.isArray(s?.history) ? s.history : [];
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const role = String(msg?.role || '').toLowerCase();
    if (role !== 'user' && role !== 'assistant' && role !== 'ai') continue;
    const content = String(msg?.content || '').trim();
    if (!content) continue;
    const ts = getChatMessageTimestamp(msg);
    if (ts > 0) return ts;
  }
  return Number(s?.createdAt || s?.updatedAt || s?.lastActiveAt || 0) || 0;
}

function getSessionSortTime(s) {
  const sidebarOrder = Number(s?.sidebarOrder);
  if (Number.isFinite(sidebarOrder)) return sidebarOrder;
  // Manual sidebar ranks use a millisecond*1000 clock so adjacent reorder
  // operations can share the same timestamp. Keep the activity fallback in
  // that same unit; otherwise a new local chat (plain milliseconds) sorts
  // behind every existing manually-ranked chat until the next server refresh.
  const activity = getSessionLastMessageAt(s) || Number(s?.createdAt || 0) || 0;
  return activity * 1000;
}

function _priorityTimestampMillis(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  if (numeric >= 1e14) return Math.round(numeric / 1000);
  if (numeric < 1e11) return Math.round(numeric * 1000);
  return numeric;
}

function _prioritySessionActivityTime(session) {
  const candidates = [
    session?.lastMessageAt,
    session?.lastActiveAt,
    session?.updatedAt,
    session?.createdAt,
  ].map(_priorityTimestampMillis).filter(Boolean);
  (Array.isArray(session?.history) ? session.history : []).forEach((message) => {
    const role = String(message?.role || '').toLowerCase();
    if (!['user', 'assistant', 'ai'].includes(role)) return;
    const timestamp = _priorityTimestampMillis(message?.timestamp);
    if (timestamp) candidates.push(timestamp);
  });
  return candidates.length ? Math.max(...candidates) : Date.now();
}

let _sessionListRefreshFrame = 0;
function scheduleSessionListRefresh() {
  if (_sessionListRefreshFrame) return;
  const refresh = () => {
    _sessionListRefreshFrame = 0;
    window.renderSessionsList?.();
    window.refreshVisibleChannelsList?.();
  };
  _sessionListRefreshFrame = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(refresh)
    : setTimeout(refresh, 0);
}
window.scheduleSessionListRefresh = scheduleSessionListRefresh;

async function loadSettledSessions({ reset = false } = {}) {
  if (_settledSessionsLoading) return;
  if (reset) {
    _settledSessions = [];
    _settledSessionsOffset = 0;
    _settledSessionsHasMore = false;
  }
  if (!reset && !_settledSessionsHasMore && _settledSessions.length) return;
  _settledSessionsLoading = true;
  renderSessionsList();
  try {
    const params = new URLSearchParams({
      state: 'settled',
      scope: 'all',
      includeAutomated: '0',
      limit: String(SIDEBAR_SESSION_PAGE_SIZE),
      offset: String(_settledSessionsOffset),
    });
    const response = await fetch(`/api/sessions?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const page = await response.json();
    const incoming = Array.isArray(page?.sessions) ? page.sessions : [];
    const byId = new Map((_settledSessions || []).map(item => [String(item.id), item]));
    incoming.forEach(item => byId.set(String(item.id), item));
    _settledSessions = Array.from(byId.values());
    _settledSessionsOffset = Number(page?.offset || _settledSessionsOffset) + incoming.length;
    _settledSessionsHasMore = page?.hasMore === true;
  } catch (error) {
    if (typeof showToast === 'function') showToast('Could not load settled chats', error?.message || 'Please try again.', 'error');
  } finally {
    _settledSessionsLoading = false;
    renderSessionsList();
  }
}

function toggleSettledSessionsView() {
  _priorityPanelOpen = false;
  document.getElementById('sidebar')?.classList.remove('priority-panel-open');
  document.getElementById('sidebarPriorityToggle')?.setAttribute('aria-expanded', 'false');
  document.getElementById('sidebarPriorityToggle')?.setAttribute('aria-pressed', 'false');
  _settledViewOpen = true;
  _sessionSearchQuery = '';
  _sessionSearchResults = [];
  _sessionSearchError = '';
  _settledSessionsOffset = 0;
  _settledSessionsHasMore = false;
  renderSessionsList();
  loadSettledSessions({ reset: true });
}

function closeSettledSessionsView() {
  _settledViewOpen = false;
  _sessionSearchQuery = '';
  _sessionSearchResults = [];
  _sessionSearchError = '';
  renderSessionsList();
}

function _renderSettledSessionsList(el) {
  const pinnedSection = document.getElementById('sidebar-pinned-section');
  if (pinnedSection) pinnedSection.style.display = 'none';
  const projectsSection = document.getElementById('sidebar-projects-section');
  const projectsListEl = document.getElementById('sidebar-projects-list');
  if (projectsListEl) projectsListEl.innerHTML = '';
  if (projectsSection) projectsSection.style.display = 'none';
  const sessions = _sessionSearchQuery
    ? (_sessionSearchResults || []).map(sessionFromSearchResult).filter(Boolean)
    : (_settledSessions || []);
  ensureSidebarBranchMetadata(sessions);
  const cards = sessions
    .filter(isTopLevelWebChatSession)
    .map(session => renderChatSessionCard(session, { settled: true }))
    .join('');
  let content = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 8px">
      <button class="sidebar-action" onclick="closeSettledSessionsView()" aria-label="Back to chats">← Chats</button>
      <span style="font-size:11px;color:var(--sidebar-muted, var(--muted));font-weight:700">Settled</span>
    </div>
  `;
  content += cards || (_settledSessionsLoading
    ? '<div class="empty-state">Loading settled chats...</div>'
    : _sessionSearchLoading
      ? '<div class="empty-state">Searching settled chats...</div>'
      : `<div class="empty-state">${_sessionSearchQuery ? `No settled chats match "${escHtml(_sessionSearchQuery)}".` : 'No settled chats yet.'}</div>`);
  if (_sessionSearchError) content += `<div class="session-search-error">${escHtml(_sessionSearchError)}</div>`;
  if (!_sessionSearchQuery && _settledSessionsHasMore) {
    content += `<button class="sessions-show-more-btn" onclick="loadSettledSessions()" style="width:100%;margin-top:8px;padding:8px 12px;background:color-mix(in srgb, var(--pm-gold, var(--brand)) 12%, transparent);border:1px solid color-mix(in srgb, var(--pm-gold, var(--brand)) 30%, transparent);color:var(--text);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'Manrope',sans-serif">Load more settled chats</button>`;
  }
  el.innerHTML = content;
}

const CHAT_SETTLE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.2"></circle><path d="m8.5 12.2 2.2 2.2 4.8-5"></path></svg>';

function _prioritySessionPreview(session) {
  const history = Array.isArray(session?.history) ? session.history : [];
  const readText = (value) => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      return value.text || value.content || value.message || value.body?.text || '';
    }
    return '';
  };
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    const role = String(message?.role || '').toLowerCase();
    const content = String(readText(message?.content) || readText(message?.body) || readText(message?.text) || readText(message?.message) || '').replace(/\s+/g, ' ').trim();
    if ((role === 'user' || role === 'assistant' || role === 'ai') && content) return content;
  }
  const fallback = String(
    readText(session?.lastMessagePreview)
      || readText(session?.lastMessage)
      || readText(session?.preview)
      || readText(session?.latestMessage)
      || readText(session?.summary)
      || '',
  ).replace(/\s+/g, ' ').trim();
  return fallback || 'No messages yet.';
}

function _prioritySessionModel(session) {
  const route = session?.chatModelRoute && typeof session.chatModelRoute === 'object' ? session.chatModelRoute : null;
  return String(route?.model || session?.model || session?.modelName || (String(session?.id || '') === String(window.activeChatSessionId || '') ? window._activeModel : '') || 'Prometheus').trim();
}

function _prioritySessionMessageCount(session) {
  const explicit = Number(session?.messageCount || 0);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  return Array.isArray(session?.history) ? session.history.length : 0;
}

function _priorityDayLabel(timestamp) {
  const value = _priorityTimestampMillis(timestamp);
  const date = new Date(Number.isFinite(value) && value > 0 ? value : Date.now());
  const now = new Date();
  const startOfDay = (candidate) => new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate()).getTime();
  const dayDelta = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (dayDelta <= 0) return 'Today';
  if (dayDelta === 1) return 'Yesterday';
  if (dayDelta < 7) return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function renderPriorityChatSessionCard(s, options = {}) {
  const isPinned = _pinnedChats.includes(s.id);
  const isSettled = options.settled === true || s.settled === true || Number(s.settledAt || 0) > 0;
  const projectId = String(options.projectId || '').trim();
  const projectLabel = String(options.projectLabel || (options.projectNested ? s.projectName : '') || '').trim();
  const openHandler = projectId
    ? `openProjectSession('${projectId}','${s.id}')`
    : s._searchOnly
      ? `openSearchSession('${s.id}')`
      : isSettled
        ? `openSettledSession('${s.id}')`
        : `openSession('${s.id}')`;
  const sessionTimestamp = _prioritySessionActivityTime(s);
  const title = String(s.title || 'New chat').trim() || 'New chat';
  const preview = _prioritySessionPreview(s);
  const model = _prioritySessionModel(s);
  const messageCount = _prioritySessionMessageCount(s);
  const branch = renderSidebarBranchIndicator(s, 'priority');
  const isWorking = _isSessionWorking(s);
  const priorityStatus = isWorking
    ? '<span class="priority-chat-status priority-chat-working">Working</span>'
    : s.unread
      ? '<span class="priority-chat-status priority-chat-unread">Unread</span>'
      : '';
  const folderIcon = '<svg class="priority-chat-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l1.7 2h7.3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"></path><path d="M3.5 9.5h17"></path></svg>';
  const settleLabel = isSettled ? 'Reopen chat' : 'Settle chat';
  const settleAction = isSettled
    ? `confirmSessionHoverUnsettle('${s.id}')`
    : `confirmSessionHoverSettle('${s.id}', '${escHtml(title)}')`;
  const nestedClass = options.projectNested ? ' project-chat-session-card' : '';
  return `
    <div class="priority-chat-card${nestedClass} ${s.id === window.activeChatSessionId ? 'active' : ''}${isWorking ? ' is-working' : ''}${s.unread && !isWorking ? ' unread' : ''}${isPinned ? ' pinned-chat' : ''}${isSettled ? ' settled-chat' : ''}${_isImportedSession(s) ? ' imported-session-card' : ''}" data-session-hover-preview data-session-id="${escHtml(s.id)}" data-session-channel="${escHtml(String(s.channel || 'web'))}" data-session-title="${escHtml(title)}" onclick="if (consumeSidebarClick(event)) return; ${openHandler}">
      <div class="priority-chat-topline">
        <div class="priority-chat-title-wrap">
          ${renderImportedSourceLogo(s)}
          <span class="priority-chat-title">${escHtml(title)}</span>
        </div>
        <span class="priority-chat-time" title="Last activity">${timeAgo(sessionTimestamp)}</span>
        <div class="priority-chat-actions" aria-label="Chat actions">
          <button class="chat-session-action-btn chat-settle-btn${isSettled ? ' active' : ''}" type="button" onclick="event.preventDefault();event.stopPropagation();${settleAction}" title="${settleLabel}" aria-label="${settleLabel}">${CHAT_SETTLE_ICON}</button>
          <button class="chat-session-action-btn chat-pin-btn${isPinned ? ' active' : ''}" type="button" onclick="toggleChatPin('${s.id}', event)" title="${isPinned ? 'Unpin' : 'Pin'} chat" aria-label="${isPinned ? 'Unpin' : 'Pin'} chat">${SKILL_STAR_ICON(isPinned)}</button>
        </div>
      </div>
      <div class="priority-chat-preview">${escHtml(preview)}</div>
      <div class="priority-chat-meta">
        <span class="priority-chat-model">${escHtml(model)}</span>
        <span aria-hidden="true">·</span>
        <span>${messageCount} message${messageCount === 1 ? '' : 's'}</span>
        ${priorityStatus ? `<span aria-hidden="true">·</span>${priorityStatus}` : ''}
        ${projectLabel ? `<span aria-hidden="true">·</span><span class="priority-chat-project">${folderIcon}<span>${escHtml(projectLabel)}</span></span>` : ''}
        ${branch}
      </div>
    </div>`;
}

function renderChatSessionCard(s, options = {}) {
  if (options.priority === true) return renderPriorityChatSessionCard(s, options);
  const isPinned = _pinnedChats.includes(s.id);
  const isSettled = options.settled === true || s.settled === true || Number(s.settledAt || 0) > 0;
  const searchResult = getSessionSearchResult(s.id);
  const projectId = String(options.projectId || '').trim();
  const projectLabel = options.projectNested ? '' : (s.projectName || searchResult?.projectName || '');
  // Origin channel (Desktop app / Telegram / Mobile) is intentionally not shown
  // in the sessions list — keep Project badges only.
  const sourceBadge = projectLabel ? `Project: ${projectLabel}` : '';
  const openHandler = projectId
    ? `openProjectSession('${projectId}','${s.id}')`
    : s._searchOnly
      ? `openSearchSession('${s.id}')`
    : s._serverOnlyTerminal
      ? `openTerminalSession('${s.id}')`
    : isSettled
      ? `openSettledSession('${s.id}')`
      : `openSession('${s.id}')`;
  const searchPreview = renderSessionSearchPreview(s);
  const isWorking = _isSessionWorking(s);
  const sessionTimestamp = getSessionLastMessageAt(s) || s.createdAt;
  const sessionMeta = [
    s.isProposal ? '<span class="session-auto-badge" style="background:var(--brand)">Proposal</span>' : '',
    sourceBadge ? `<span class="badge badge-queued">${escHtml(sourceBadge)}</span>` : '',
    isWorking ? '<span class="session-working-badge">Working</span>' : '',
  ].filter(Boolean).join('');
  const unreadDot = s.unread && !isWorking && !_isImportedSession(s)
    ? '<span class="session-unread-dot" title="Unread" aria-label="Unread"></span>'
    : '';
  const nestedClass = options.projectNested ? ' project-chat-session-card' : '';
  const projectDeleteAction = projectId && options.projectDelete
    ? `<button class="chat-session-action-btn project-chat-delete-btn" onclick="event.stopPropagation();confirmDeleteProjectSession('${projectId}','${s.id}','${escHtml(s.title || 'New chat')}')" title="Delete chat" aria-label="Delete chat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>`
    : '';
  const settleLabel = isSettled ? 'Reopen chat' : 'Settle chat';
  const settleAction = isSettled
    ? `confirmSessionHoverUnsettle('${s.id}')`
    : `confirmSessionHoverSettle('${s.id}', '${escHtml(s.title || 'New chat')}')`;
  const settleButton = `<button class="chat-session-action-btn chat-settle-btn${isSettled ? ' active' : ''}" onclick="event.preventDefault();event.stopPropagation();${settleAction}" title="${settleLabel}" aria-label="${settleLabel}">${CHAT_SETTLE_ICON}</button>`;
  return `
    <div class="job-item chat-session-item${nestedClass} ${s.id === window.activeChatSessionId ? 'active' : ''}${isWorking ? ' is-working' : ''}${s.unread && !isWorking ? ' unread' : ''}${isPinned ? ' pinned-chat' : ''}${isSettled ? ' settled-chat' : ''}${_isImportedSession(s) ? ' imported-session-card' : ''}" data-session-hover-preview data-session-id="${escHtml(s.id)}" data-session-channel="${escHtml(String(s.channel || 'web'))}" data-session-title="${escHtml(s.title || 'New chat')}" draggable="true" ondragstart="beginSidebarSessionDrag(event)" ondragover="allowSidebarSessionDrop(event)" ondragleave="leaveSidebarSessionDrop(event)" ondrop="dropSidebarSession(event)" ondragend="endSidebarSessionDrag()" onpointerenter="queueSessionHoverPreview(this)" onpointerleave="scheduleSessionHoverPreviewClose()" onclick="if (consumeSidebarClick(event)) return; ${openHandler}">
      ${renderImportedSourceMeta(s, sessionTimestamp)}
      ${settleButton}
      <button class="chat-session-action-btn chat-pin-btn${isPinned ? ' active' : ''}" onclick="toggleChatPin('${s.id}', event)" title="${isPinned ? 'Unpin' : 'Pin'} chat" aria-label="${isPinned ? 'Unpin' : 'Pin'} chat">${SKILL_STAR_ICON(isPinned)}</button>
      ${projectDeleteAction}
      <div class="job-item-head job-item-head--pinned">
        <div class="job-item-title-wrap">
          ${unreadDot}
          ${renderImportedSourceLogo(s)}
          <div class="job-item-title">${escHtml(s.title || 'New chat')}</div>
        </div>
      </div>
      ${sessionMeta ? `<div class="job-item-meta">${sessionMeta}</div>` : ''}
      ${searchPreview}
    </div>
  `;
}
window.renderChatSessionCard = renderChatSessionCard;

function isTopLevelWebChatSession(s) {
  if (!s || typeof s !== 'object') return false;
  // Project chats live exclusively in their owning project's tree.  This
  // remains true for pinned and server-rehydrated sessions as well.
  if (String(s.projectId || '').trim() || String(s.source || '').toLowerCase() === 'project') return false;
  if (s.sideChat === true || s.parentSessionId) return false;
  if (/^side_/i.test(String(s.id || ''))) return false;
  return true;
}

function openSettledSession(id) {
  const sid = String(id || '').trim();
  if (!sid) return;
  let sess = (window.chatSessions || []).find(s => String(s.id) === sid);
  if (!sess) sess = (_settledSessions || []).find(s => String(s.id) === sid);
  if (sess) {
    window.chatSessions = Array.isArray(window.chatSessions) ? window.chatSessions : [];
    if (!window.chatSessions.some(s => String(s.id) === sid)) window.chatSessions.unshift(sess);
  }
  openSession(sid);
}

let _sidebarDraggedSessionId = '';
let _sidebarDraggedCard = null;
let _sidebarDragSuppressClickUntil = 0;

function consumeSidebarClick(event) {
  if (Date.now() >= _sidebarDragSuppressClickUntil) return false;
  event?.preventDefault?.();
  event?.stopPropagation?.();
  return true;
}

function beginSidebarSessionDrag(event) {
  const card = event.currentTarget;
  if (event.target?.closest?.('button, input, a')) {
    event.preventDefault();
    return;
  }
  _sidebarDraggedSessionId = String(card?.dataset?.sessionId || '').trim();
  _sidebarDraggedCard = card;
  if (!_sidebarDraggedSessionId) {
    event.preventDefault();
    return;
  }
  card.classList.add('is-dragging');
  event.dataTransfer?.setData('text/plain', _sidebarDraggedSessionId);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function allowSidebarSessionDrop(event) {
  const card = event.currentTarget;
  const targetId = String(card?.dataset?.sessionId || '').trim();
  if (!_sidebarDraggedSessionId || !_sidebarDraggedCard || targetId === _sidebarDraggedSessionId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  card.classList.add('drag-over');
}

function leaveSidebarSessionDrop(event) {
  event.currentTarget?.classList?.remove('drag-over');
}

function endSidebarSessionDrag() {
  _sidebarDraggedCard?.classList?.remove('is-dragging');
  document.querySelectorAll('.chat-session-item.drag-over').forEach((card) => card.classList.remove('drag-over'));
  _sidebarDraggedCard = null;
  _sidebarDraggedSessionId = '';
}

function _prioritySection(title, body, count = 0) {
  if (!body) return '';
  const key = String(title || '').trim();
  const collapsed = _priorityCollapsedSections.has(key);
  return `<section class="priority-section sidebar-section${collapsed ? ' is-collapsed' : ''}" data-priority-section="${escHtml(key)}">
    <button class="section-title sidebar-section-toggle priority-section-toggle" type="button" onclick="togglePrioritySection(event)" aria-expanded="${collapsed ? 'false' : 'true'}">
      <span>${escHtml(key)}</span>
      <span class="sidebar-section-decoration" aria-hidden="true"><span class="sidebar-section-icon">✦</span></span>
    </button>
    <div class="priority-section-list">${body}</div>
  </section>`;
}

function _renderPriorityPanel(el) {
  const priorityPanel = document.getElementById('sidebar-priority-panel');
  const priorityContent = document.getElementById('sidebar-priority-content');
  const pinnedSection = document.getElementById('sidebar-pinned-section');
  const projectsSection = document.getElementById('sidebar-projects-section');
  const sessionsSection = document.getElementById('sidebar-sessions-section');
  if (!priorityPanel || !priorityContent) return;

  priorityPanel.hidden = false;
  if (pinnedSection) pinnedSection.style.display = 'none';
  if (projectsSection) projectsSection.style.display = 'none';
  if (sessionsSection) sessionsSection.style.display = 'none';

  const activeSessions = (window.chatSessions || [])
    .filter(_isPrioritySession)
    .sort((a, b) => _prioritySessionActivityTime(b) - _prioritySessionActivityTime(a));
  ensureSidebarBranchMetadata(activeSessions.slice(0, 80));
  // Priority attention is not paginated behind newer ordinary chats. Every
  // working or unread session must remain visible in the Priority section.
  const prioritySessions = activeSessions.filter(_isPriorityAttentionSession);
  const chronologicalCandidates = activeSessions.filter((session) => (
    !_isPriorityAttentionSession(session)
    && (
      isTopLevelWebChatSession(session)
        || String(session?.projectId || '').trim()
        || String(session?.source || '').toLowerCase() === 'project'
    )
  ));
  const displayedChronologicalSessions = chronologicalCandidates.slice(0, _sessionShowCount);
  const hasMorePrioritySessions = chronologicalCandidates.length > _sessionShowCount;
  const priorityHtml = prioritySessions.map((session) => renderChatSessionCard(session, {
    priority: true,
    projectId: session.projectId || '',
    projectNested: Boolean(session.projectId),
    projectLabel: session.projectName || '',
  })).join('');

  // Priority mode is intentionally a flat inbox. Project membership remains
  // visible on each card through its folder/project metadata, but project
  // chats are not hidden behind a second expandable tree here.
  const chronologicalSessions = displayedChronologicalSessions;
  const dayGroups = new Map();
  chronologicalSessions.forEach((session) => {
    const label = _priorityDayLabel(_prioritySessionActivityTime(session));
    if (!dayGroups.has(label)) dayGroups.set(label, []);
    dayGroups.get(label).push(session);
  });
  const dayHtml = Array.from(dayGroups.entries()).map(([label, sessions]) => _prioritySection(
    label,
    sessions.map(session => renderChatSessionCard(session, { priority: true })).join(''),
    sessions.length,
  )).join('');
  const prioritySection = _prioritySection('Priority', priorityHtml || '<div class="priority-empty">No priority chats.</div>', prioritySessions.length);
  const chronologicalSection = dayHtml || '<div class="priority-empty">No active chats yet.</div>';
  const priorityControls = `
    ${hasMorePrioritySessions ? `<button class="sessions-show-more-btn" onclick="showMoreSessions()" style="width:100%;margin-top:8px;padding:8px 12px;background:rgba(249,115,22,0.12);border:1px solid rgba(249,115,22,0.30);color:var(--text);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'Manrope',sans-serif;transition:all 0.15s ease" onmouseover="this.style.background='rgba(249,115,22,0.20)'" onmouseout="this.style.background='rgba(249,115,22,0.12)'">+ Show more (${chronologicalCandidates.length - _sessionShowCount} more)</button>` : ''}
    <button class="sessions-show-more-btn settled-entry-btn" onclick="toggleSettledSessionsView()" style="width:100%;margin-top:8px;padding:8px 12px;background:transparent;border:1px solid var(--line);color:var(--sidebar-muted, var(--muted));border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'Manrope',sans-serif;transition:all 0.15s ease" onmouseover="this.style.background='color-mix(in srgb, var(--pm-gold, var(--brand)) 10%, transparent)'" onmouseout="this.style.background='transparent'">Settled</button>`;
  priorityContent.innerHTML = prioritySection + chronologicalSection + priorityControls;
  syncPriorityBell();
  void el;
}

function sidebarSessionIdsInList(list) {
  return Array.from(list?.querySelectorAll?.('[data-session-id]') || [])
    .map((card) => String(card.dataset.sessionId || '').trim())
    .filter(Boolean);
}

function setLocalSidebarOrder(sessionIds) {
  const ids = [...new Set(sessionIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const orderBase = Date.now() * 1000 + ids.length + 1;
  const ranks = new Map(ids.map((id, index) => [id, orderBase + ids.length - index]));
  (window.chatSessions || []).forEach((session) => {
    const rank = ranks.get(String(session?.id || ''));
    if (rank !== undefined) session.sidebarOrder = rank;
  });
  (_settledSessions || []).forEach((session) => {
    const rank = ranks.get(String(session?.id || ''));
    if (rank !== undefined) session.sidebarOrder = rank;
  });
}

async function persistSidebarOrder(sessionIds, channel = 'web') {
  const ids = [...new Set(sessionIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return;
  const response = await fetch('/api/sessions/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionIds: ids, channel, state: _settledViewOpen ? 'settled' : 'all' }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  setLocalSidebarOrder(ids);
  saveChatSessions();
}

async function dropSidebarSession(event) {
  event.preventDefault();
  const target = event.currentTarget;
  const draggedId = _sidebarDraggedSessionId;
  const draggedCard = _sidebarDraggedCard;
  const targetId = String(target?.dataset?.sessionId || '').trim();
  const sourceList = draggedCard?.parentElement;
  const targetList = target?.parentElement;
  if (!draggedId || !draggedCard || !targetId || draggedId === targetId || !sourceList || !targetList) {
    endSidebarSessionDrag();
    return;
  }

  const mainLists = new Set(['jobs-list', 'pinned-chats-list']);
  const isMainSidebarMove = mainLists.has(String(sourceList.id || '')) && mainLists.has(String(targetList.id || ''));
  try {
    if (isMainSidebarMove && sourceList !== targetList) {
      const shouldPin = targetList.id === 'pinned-chats-list';
      const isPinned = _pinnedChats.includes(draggedId);
      if (shouldPin !== isPinned) {
        const pinResponse = await fetch(`/api/sessions/${encodeURIComponent(draggedId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinned: shouldPin }),
        });
        if (!pinResponse.ok) throw new Error(`HTTP ${pinResponse.status}`);
        if (shouldPin) _pinnedChats.push(draggedId);
        else _pinnedChats.splice(_pinnedChats.indexOf(draggedId), 1);
        localStorage.setItem('prometheus_pinned_chats', JSON.stringify(_pinnedChats));
      }
    }

    const targetIds = sidebarSessionIdsInList(targetList).filter((id) => id !== draggedId);
    const targetRect = target.getBoundingClientRect?.();
    let insertionIndex = targetIds.indexOf(targetId);
    if (insertionIndex < 0) insertionIndex = targetIds.length;
    if (targetRect && event.clientY > targetRect.top + targetRect.height / 2) insertionIndex += 1;
    targetIds.splice(insertionIndex, 0, draggedId);

    let orderedIds = targetIds;
    if (isMainSidebarMove) {
      const pinnedList = document.getElementById('pinned-chats-list');
      const jobsList = document.getElementById('jobs-list');
      const pinnedIds = sidebarSessionIdsInList(pinnedList).filter((id) => id !== draggedId);
      const normalIds = sidebarSessionIdsInList(jobsList).filter((id) => id !== draggedId);
      if (targetList.id === 'pinned-chats-list') pinnedIds.splice(insertionIndex, 0, draggedId);
      else normalIds.splice(insertionIndex, 0, draggedId);
      orderedIds = [...pinnedIds, ...normalIds];
    }
    await persistSidebarOrder(orderedIds, String(target.dataset.sessionChannel || 'web'));
    _sidebarDragSuppressClickUntil = Date.now() + 400;
    renderSessionsList();
    if (_channelsViewOpen) renderChannelsList();
  } catch (error) {
    if (typeof showToast === 'function') showToast('Could not reorder this thread', 'error');
  } finally {
    endSidebarSessionDrag();
  }
}

function renderSessionsList() {
  const el = document.getElementById('jobs-list');
  if (!el) return;
  const priorityPanel = document.getElementById('sidebar-priority-panel');
  if (_priorityPanelOpen) {
    _renderPriorityPanel(el);
    return;
  }
  if (priorityPanel) priorityPanel.hidden = true;
  const sessionsSection = document.getElementById('sidebar-sessions-section');
  if (sessionsSection) sessionsSection.style.display = '';
  syncPriorityBell();
  if (_settledViewOpen) {
    _renderSettledSessionsList(el);
    return;
  }
  const allSessions = (window.chatSessions || []);
  const chatSessions = allSessions.filter(s => isTopLevelWebChatSession(s) && s.settled !== true && Number(s.settledAt || 0) <= 0);
  const indexedMatchIds = new Set((_sessionSearchResults || []).map(r => String(r.id)));
  const searchOnlySessions = _sessionSearchQuery
    ? (_sessionSearchResults || [])
        .map(sessionFromSearchResult)
        .filter(s => s && isTopLevelWebChatSession(s) && !allSessions.some(existing => String(existing.id) === String(s.id)))
    : [];

  const byId = new Map();
  [...chatSessions, ...searchOnlySessions].forEach((session) => {
    if (session?.id && !byId.has(String(session.id))) byId.set(String(session.id), session);
  });
  let sorted = Array.from(byId.values()).sort((a, b) => getSessionSortTime(b) - getSessionSortTime(a));
  if (_sessionSearchQuery) {
    sorted = sorted.filter(s => {
      const title = (s.title || 'New chat').toLowerCase();
      const msgs = (s.history || []).map(m => (m.content || '').toLowerCase()).join(' ');
      return title.includes(_sessionSearchQuery) || msgs.includes(_sessionSearchQuery) || indexedMatchIds.has(String(s.id));
    });
  }

  const pinned = sorted.filter(s => _pinnedChats.includes(s.id));
  const unpinned = sorted.filter(s => !_pinnedChats.includes(s.id));
  const displayedUnpinned = unpinned.slice(0, _sessionShowCount);
  const hasMore = unpinned.length > _sessionShowCount;
  ensureSidebarBranchMetadata([...pinned, ...displayedUnpinned]);

  // Render pinned chats into the dedicated section above Sessions
  const pinnedSection = document.getElementById('sidebar-pinned-section');
  const pinnedListEl = document.getElementById('pinned-chats-list');
  const onChatsTab = (window.sidebarTab || 'chats') === 'chats' || document.querySelector('[data-tab="chats"]')?.classList.contains('active');
  if (pinnedSection && pinnedListEl) {
    if (pinned.length && onChatsTab) {
      pinnedListEl.innerHTML = pinned.map(renderChatSessionCard).join('');
      pinnedSection.style.display = '';
    } else {
      pinnedListEl.innerHTML = '';
      pinnedSection.style.display = 'none';
    }
  }

  const projectRows = typeof window.renderProjectChatRows === 'function'
    ? window.renderProjectChatRows({ query: _sessionSearchQuery })
    : '';
  const projectsSection = document.getElementById('sidebar-projects-section');
  const projectsListEl = document.getElementById('sidebar-projects-list');
  if (projectsSection && projectsListEl) {
    if (projectRows && onChatsTab) {
      projectsListEl.innerHTML = projectRows;
      projectsSection.style.display = '';
    } else {
      projectsListEl.innerHTML = '';
      projectsSection.style.display = 'none';
    }
  }
  const html = displayedUnpinned.map(renderChatSessionCard).join('');

  let content = html || (
    _sessionSearchLoading
      ? `<div class="empty-state">Searching full chat history...</div>`
      : (_sessionSearchQuery
        ? `<div class="empty-state">No sessions match "${escHtml(_sessionSearchQuery)}".</div>`
        : '<div class="empty-state">No chats yet.<br>Start a new conversation.</div>')
  );
  if (_sessionSearchError) {
    content += `<div class="session-search-error">${escHtml(_sessionSearchError)}</div>`;
  }

  // Add "Show more" button if there are more sessions
  if (hasMore) {
    content += `<button class="sessions-show-more-btn" onclick="showMoreSessions()" style="width:100%;margin-top:8px;padding:8px 12px;background:rgba(249,115,22,0.12);border:1px solid rgba(249,115,22,0.30);color:var(--text);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'Manrope',sans-serif;transition:all 0.15s ease" onmouseover="this.style.background='rgba(249,115,22,0.20)'" onmouseout="this.style.background='rgba(249,115,22,0.12)'">
      + Show more (${unpinned.length - _sessionShowCount} more)
    </button>`;
  }

  content += `<button class="sessions-show-more-btn settled-entry-btn" onclick="toggleSettledSessionsView()" style="width:100%;margin-top:8px;padding:8px 12px;background:transparent;border:1px solid var(--line);color:var(--sidebar-muted, var(--muted));border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'Manrope',sans-serif;transition:all 0.15s ease" onmouseover="this.style.background='color-mix(in srgb, var(--pm-gold, var(--brand)) 10%, transparent)'" onmouseout="this.style.background='transparent'">
    Settled
  </button>`;

  // When searching, append matching skills inline below sessions
  if (_sessionSearchQuery && typeof skillsCache !== 'undefined' && skillsCache.length) {
    const matchedSkills = skillsCache.filter(s => skillSearchText(s).includes(_sessionSearchQuery));
    if (matchedSkills.length) {
      content += `<div class="sessions-section-header" style="margin-top:10px">Skills</div>` +
        matchedSkills.map(s => `
          <div class="job-item" onclick="setSidebarSegTab('skills');openSkillReadOnly('${escHtml(s.id)}')" style="cursor:pointer">
            <div style="display:flex;align-items:center;gap:7px">
              <span style="font-size:11px;color:#f97316;opacity:0.8">&#9650;</span>
              <div class="job-item-title">${escHtml(s.name)}</div>
              ${renderSkillBadge(s)}
              ${s.enabled ? '<span class="badge" style="background:rgba(49,184,132,0.18);color:#4ade80;border:1px solid rgba(49,184,132,0.3);font-size:9px;padding:1px 5px">ON</span>' : ''}
            </div>
            ${s.description ? `<div style="color:var(--sidebar-muted);font-size:10px;margin-top:3px;padding-left:18px">${escHtml(s.description)}</div>` : ''}
          </div>
        `).join('');
    }
  }

  el.innerHTML = content;

}

function _updateChannelsBadge() {
  const btn = document.getElementById('btn-channels');
  if (!btn) return;
  const unreadCount = (window.chatSessions || []).filter(s => _isChannelSession(s) && s.unread).length;
  // Remove existing badge if any
  btn.querySelectorAll('.ch-badge').forEach(b => b.remove());
  if (unreadCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'ch-badge';
    badge.style.cssText = 'display:inline-block;background:#e05c5c;color:#fff;border-radius:99px;font-size:9px;font-weight:800;padding:1px 5px;margin-left:4px;vertical-align:middle';
    badge.textContent = unreadCount;
    btn.appendChild(badge);
  }
}

// ---- Token counter ----
function estimateTokens(history) {
  if (!history || history.length === 0) return 0;
  // ~4 chars per token is a reasonable approximation
  const chars = history.reduce((sum, m) => sum + (m.content || '').length, 0);
  return Math.round(chars / 4);
}

function updateTokenCount() {
  const badge = document.getElementById('token-count-badge');
  if (!badge) return;
  const count = estimateTokens(chatHistory);
  if (count === 0) { badge.textContent = ''; return; }
  const k = count >= 1000 ? (count / 1000).toFixed(1) + 'k' : count;
  badge.textContent = `· visible ~${k} tokens`;
}

// ---- Model switcher ----
let _modelSwitcherOpen = false;

const LOCAL_PROVIDERS = new Set(['ollama', 'llama_cpp', 'lm_studio']);
const EFFORT_CAPABLE_PROVIDERS = new Set(['openai', 'openai_codex', 'anthropic', 'perplexity', 'xai']);
const THINKING_CAPABLE_PROVIDERS = new Set(['anthropic']);

function _documentedReasoningCapability(provider, model) {
  const name = String(model || '').trim().toLowerCase().split('/').filter(Boolean).pop() || '';
  if (provider === 'openai_codex') {
    if (/^gpt-5\.6-(?:sol|terra)(?:-|$)/.test(name)) return { efforts: ['low','medium','high','xhigh','max','ultra'], defaultEffort: 'medium' };
    if (/^gpt-5\.6(?:-luna)?(?:-|$)/.test(name)) return { efforts: ['low','medium','high','xhigh','max'], defaultEffort: 'medium' };
    if (/^gpt-5\.5(?:-|$)/.test(name)) return { efforts: ['low','medium','high','xhigh'], defaultEffort: 'medium' };
    if (/^gpt-5\.(?:[234])(?:-|$)/.test(name)) return { efforts: ['low','medium','high','xhigh'], defaultEffort: 'low' };
    if (/^gpt-5(?:-(?:mini|nano|pro))?(?:-|$)/.test(name)) return { efforts: ['low','medium','high'], defaultEffort: 'medium' };
    if (/^o(?:1|3|4-mini)(?:-|$)/.test(name)) return { efforts: ['low','medium','high'], defaultEffort: 'medium' };
    return { efforts: [] };
  }
  if (provider === 'openai') {
    if (/^gpt-5\.6(?:-(?:sol|terra|luna))?(?:-|$)/.test(name)) return { efforts: ['low','medium','high','xhigh','max'], defaultEffort: 'medium' };
    if (/^gpt-5\.5(?:-|$)/.test(name)) return { efforts: ['low','medium','high','xhigh'], defaultEffort: 'medium' };
    if (/^gpt-5\.(?:[234])(?:-|$)/.test(name)) return { efforts: ['low','medium','high','xhigh'], defaultEffort: 'low' };
    if (/^gpt-5(?:-(?:mini|nano|pro))?(?:-|$)/.test(name)) return { efforts: ['low','medium','high'], defaultEffort: 'medium' };
    if (/^o(?:1|3|4-mini)(?:-|$)/.test(name)) return { efforts: ['low','medium','high'], defaultEffort: 'medium' };
    return { efforts: [] };
  }
  if (provider === 'anthropic') {
    if (!/^claude-(?:fable-5|mythos-(?:5|preview)|opus-4-(?:5|6|7|8)|sonnet-(?:5|4-6))(?:-|$)/.test(name)) {
      return { efforts: [], thinkingMode: /^claude-(?:haiku-4-5|sonnet-4-5|opus-4-[01])(?:-|$)/.test(name) ? 'manual' : '' };
    }
    const efforts = ['low','medium','high'];
    if (/^claude-(?:fable-5|mythos-5|opus-4-(?:7|8)|sonnet-5)(?:-|$)/.test(name)) efforts.push('xhigh');
    if (!/^claude-opus-4-5(?:-|$)/.test(name)) efforts.push('max');
    return { efforts, defaultEffort: 'high', thinkingMode: /^claude-opus-4-5(?:-|$)/.test(name) ? 'manual' : 'adaptive' };
  }
  return { efforts: [] };
}

function _supportsFastSpeed(provider, model) {
  const name = String(model || '').trim().toLowerCase().split('/').filter(Boolean).pop() || '';
  if (provider === 'anthropic') return /^claude-opus-4-(?:7|8)(?:-|$)/.test(name);
  if (provider === 'openai' || provider === 'openai_codex') return /^(?:gpt-5\.6(?:-(?:sol|terra|luna))?|gpt-5\.5|gpt-5\.4(?:-mini)?|gpt-5\.2|gpt-5\.1|gpt-5(?:-mini)?|gpt-4\.1(?:-mini|-nano)?|gpt-4o(?:-mini)?|o3|o4-mini)(?:-\d{4}.*|$)/.test(name);
  return false;
}

function syncProviderReasoningControls(provider) {
  const modelId = provider === 'openai' ? 'settings-openai-model' : provider === 'openai_codex' ? 'settings-codex-model' : 'settings-anthropic-model';
  const effortId = _getProviderReasoningControlId(provider);
  const model = document.getElementById(modelId)?.value || '';
  const select = document.getElementById(effortId);
  const cap = _documentedReasoningCapability(provider, model);
  if (select) {
    const previous = select.value;
    select.innerHTML = `<option value="">Provider default${cap.defaultEffort ? ` (${cap.defaultEffort})` : ''}</option>`
      + cap.efforts.map(v => `<option value="${v}">${v === 'xhigh' ? 'Extra High' : v[0].toUpperCase() + v.slice(1)}</option>`).join('');
    select.value = cap.efforts.includes(previous) ? previous : '';
    select.closest('label')?.toggleAttribute?.('hidden', cap.efforts.length === 0);
    select.style.display = cap.efforts.length ? '' : 'none';
  }
  if (provider === 'anthropic') {
    const row = document.getElementById('anthropic-thinking-budget-row');
    const checked = document.getElementById('settings-anthropic-extended-thinking')?.checked;
    if (row) row.style.display = checked && cap.thinkingMode === 'manual' ? 'block' : 'none';
  }
  const speedRow = document.getElementById(`settings-${provider === 'openai_codex' ? 'codex' : provider}-speed-row`);
  if (speedRow) speedRow.style.display = _supportsFastSpeed(provider, model) ? 'block' : 'none';
}
function syncAnthropicReasoningControls() { syncProviderReasoningControls('anthropic'); }
function onAnthropicThinkingToggle() { syncAnthropicReasoningControls(); }
window.syncProviderReasoningControls = syncProviderReasoningControls;
window.syncAnthropicReasoningControls = syncAnthropicReasoningControls;
window.onAnthropicThinkingToggle = onAnthropicThinkingToggle;

function _activeModelForProvider(provider, llm) {
  const providers = llm?.providers && typeof llm.providers === 'object' ? llm.providers : {};
  const configured = providers?.[provider]?.model;
  return String(configured || window._activeModel || document.getElementById('chat-model-name')?.dataset?.baseName || document.getElementById('chat-model-name')?.textContent || '').trim();
}

function _supportsAnthropicEffort(model) {
  return _documentedReasoningCapability('anthropic', model).efforts.length > 0;
}

function _supportsAnthropicXHigh(model) {
  return /^claude-opus-4-(7|8)(?:\b|[-_])/.test(String(model || ''));
}

function _effortLevelsForProvider(provider, model) {
  if (provider === 'openai' || provider === 'openai_codex') {
    const cap = _documentedReasoningCapability(provider, model);
    return [{ v: '', label: 'Provider Default', desc: cap.defaultEffort ? `Model default: ${cap.defaultEffort}` : 'Use provider default' }]
      .concat(cap.efforts.map(v => ({ v, label: v === 'xhigh' ? 'Extra High' : v[0].toUpperCase() + v.slice(1), desc: '' })));
  }
  if (provider === 'anthropic') {
    const cap = _documentedReasoningCapability(provider, model);
    return [{ v: '', label: 'Provider Default', desc: 'Anthropic default (High)' }]
      .concat(cap.efforts.map(v => ({ v, label: v === 'xhigh' ? 'Extra High' : v[0].toUpperCase() + v.slice(1), desc: '' })));
  }
  if (provider === 'xai') {
    if (/^grok-4\.20-multi-agent(?:-|$)/i.test(String(model || '').trim())) {
      return [
        { v: '',       label: 'Provider Default', desc: 'Use xAI default agent count' },
        { v: 'low',    label: 'Low',              desc: 'Fewer collaborating agents' },
        { v: 'medium', label: 'Medium',           desc: 'More agents for research work' },
        { v: 'high',   label: 'High',             desc: 'Deep multi-agent work' },
        { v: 'xhigh',  label: 'Extra High',       desc: 'Maximum multi-agent effort' },
      ];
    }
    return [
      { v: '',       label: 'Provider Default', desc: 'Use xAI default (Grok 4.3 defaults to low)' },
      { v: 'low',    label: 'Low',              desc: 'Fast tool use and general agent work' },
      { v: 'medium', label: 'Medium',           desc: 'More thinking for complex work' },
      { v: 'high',   label: 'High',             desc: 'Deep reasoning' },
    ];
  }
  return [
    { v: '',        label: 'Provider Default', desc: 'Use the model/provider default' },
    { v: 'low',     label: 'Low',            desc: 'Light thinking' },
    { v: 'medium',  label: 'Medium',         desc: 'Balanced' },
    { v: 'high',    label: 'High',           desc: 'Deep reasoning' },
  ];
}

function _getProviderReasoningControlId(provider) {
  return {
    openai: 'settings-openai-effort',
    openai_codex: 'settings-codex-effort',
    anthropic: 'settings-anthropic-effort',
    perplexity: 'settings-perplexity-effort',
    xai: 'provider-field-xai-reasoning_effort',
  }[provider] || '';
}

function _formatActiveModelLabel(model, provider, effort = '') {
  if (typeof window.formatModelWithReasoning === 'function') {
    return window.formatModelWithReasoning(model, provider, effort);
  }
  const raw = String(model || '').trim();
  const lower = raw.toLowerCase();
  const special = lower.match(/^gpt-5\.6-(sol|terra|luna)$/);
  const base = special
    ? `5.6 ${special[1].charAt(0).toUpperCase()}${special[1].slice(1)}`
    : lower === 'gpt-5.3-codex-spark' && provider === 'openai_codex'
      ? '5.3 Spark'
      : raw.replace(/^gpt-/i, 'GPT ').replace(/-/g, ' ');
  const reasoning = _normalizeActiveReasoningEffort(provider, raw, effort);
  return reasoning ? `${base} ${reasoning === 'xhigh' ? 'Extra High' : reasoning.charAt(0).toUpperCase() + reasoning.slice(1)}` : base;
}

function _normalizeActiveReasoningEffort(provider, model, effort) {
  const raw = String(effort || '').trim().toLowerCase().replace(/^extra[-_ ]high$/, 'xhigh');
  if (!raw || !EFFORT_CAPABLE_PROVIDERS.has(provider)) return raw;
  return _effortLevelsForProvider(provider, model).some(level => level.v === raw) ? raw : '';
}

function _renderActiveModelLabels(model, provider, effort = '', sessionId = '', speed) {
  const rawModel = String(model || '').trim();
  const baseName = typeof window.formatModelDisplayName === 'function'
    ? window.formatModelDisplayName(rawModel, provider)
    : _formatActiveModelLabel(rawModel, provider, '');
  const fullName = _formatActiveModelLabel(rawModel, provider, effort);
  const header = document.getElementById('current-model');
  if (header) header.textContent = fullName;
  const runtime = document.getElementById('r-model');
  if (runtime) runtime.textContent = fullName;
  const sid = String(sessionId || '').trim();
  const composer = sid
    ? Array.from(document.querySelectorAll('[data-composer-model-name="1"]'))
      .find((node) => String(node.dataset.composerModelSessionId || '') === sid)
    : document.getElementById('chat-model-name');
  if (composer) {
    composer.dataset.baseName = baseName;
    composer.dataset.rawModel = rawModel;
    composer.textContent = fullName;
  }
  const speedIcon = sid
    ? Array.from(document.querySelectorAll('[data-composer-model-speed="1"]'))
      .find((node) => String(node.dataset.composerModelSessionId || '') === sid)
    : document.getElementById('chat-model-speed-icon');
  if (speedIcon && speed !== undefined) {
    speedIcon.hidden = !(_supportsFastSpeed(provider, rawModel) && String(speed || '').toLowerCase() === 'fast');
  }
}

function applyReasoningPrefsFromProviderConfig(llm, providerOverride) {
  const llmCfg = llm && typeof llm === 'object' ? llm : window._llmSettingsCache;
  if (!llmCfg || typeof llmCfg !== 'object') return;

  const provider = providerOverride || llmCfg.provider || window._activeProvider || 'ollama';
  const providers = llmCfg.providers && typeof llmCfg.providers === 'object' ? llmCfg.providers : {};
  const providerCfg = providers[provider] && typeof providers[provider] === 'object' ? providers[provider] : {};
  window._llmSettingsCache = llmCfg;
  const activeModel = _activeModelForProvider(provider, llmCfg);
  const fast = _supportsFastSpeed(provider, activeModel) && (providerCfg.speed === 'fast' || providerCfg.fast_mode === true);
  ['chat-model-speed-icon', 'header-model-speed-icon'].forEach(id => {
    const icon = document.getElementById(id);
    if (icon) icon.hidden = !fast;
  });

  if (EFFORT_CAPABLE_PROVIDERS.has(provider)) {
    const configuredLevel = typeof providerCfg.reasoning_effort === 'string'
      ? providerCfg.reasoning_effort.trim().toLowerCase()
      : '';
    const model = _activeModelForProvider(provider, llmCfg);
    window.reasoningLevel = _normalizeActiveReasoningEffort(provider, model, configuredLevel);
    const selectId = _getProviderReasoningControlId(provider);
    const select = selectId ? document.getElementById(selectId) : null;
    if (select) select.value = window.reasoningLevel;
  }

  if (provider === 'anthropic') {
    const enabled = providerCfg.extended_thinking === true;
    const budget = Number(providerCfg.thinking_budget);
    window.anthropicExtendedThinking = enabled;
    window.anthropicThinkingBudget = Number.isFinite(budget) && budget >= 1024 ? budget : 10000;

    const checkbox = document.getElementById('settings-anthropic-extended-thinking');
    if (checkbox) checkbox.checked = enabled;
    const budgetSelect = document.getElementById('settings-anthropic-thinking-budget');
    if (budgetSelect) budgetSelect.value = String(window.anthropicThinkingBudget);
    const row = document.getElementById('anthropic-thinking-budget-row');
    if (typeof window.syncAnthropicReasoningControls === 'function') {
      window.syncAnthropicReasoningControls();
    } else if (row) {
      row.style.display = enabled ? 'block' : 'none';
    }
  }
  _renderActiveModelLabels(activeModel, provider, EFFORT_CAPABLE_PROVIDERS.has(provider) ? (window.reasoningLevel || '') : '', '', fast ? 'fast' : 'standard');
}

async function refreshReasoningPrefsFromSettings(providerOverride) {
  try {
    const data = await api('/api/settings/provider');
    const llm = data?.llm;
    if (!llm || typeof llm !== 'object') return null;
    applyReasoningPrefsFromProviderConfig(llm, providerOverride);
    return llm;
  } catch (err) {
    console.warn('refreshReasoningPrefsFromSettings:', err);
    return null;
  }
}

function _buildLlmForReasoningUpdate(baseLlm, provider, patch) {
  const next = baseLlm && typeof baseLlm === 'object'
    ? JSON.parse(JSON.stringify(baseLlm))
    : { provider: provider || window._activeProvider || 'ollama', providers: {} };
  next.provider = next.provider || provider || window._activeProvider || 'ollama';
  next.providers = next.providers && typeof next.providers === 'object' ? next.providers : {};

  const currentCfg = next.providers[provider] && typeof next.providers[provider] === 'object'
    ? next.providers[provider]
    : {};
  const providerCfg = { ...currentCfg };

  if (EFFORT_CAPABLE_PROVIDERS.has(provider)) {
    const level = typeof patch?.reasoning_effort === 'string'
      ? patch.reasoning_effort.trim()
      : (typeof patch?.level === 'string' ? patch.level.trim() : '');
    const model = String(providerCfg.model || currentCfg.model || '');
    const allowed = provider === 'perplexity' || provider === 'xai'
      ? _effortLevelsForProvider(provider, model).map(option => option.v)
      : _documentedReasoningCapability(provider, model).efforts;
    if (level && allowed.includes(level)) providerCfg.reasoning_effort = level;
    else delete providerCfg.reasoning_effort;
  }

  if (provider === 'anthropic') {
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'extended_thinking')) {
      providerCfg.extended_thinking = !!patch.extended_thinking;
    }
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'thinking_budget')) {
      const budget = Number(patch.thinking_budget);
      providerCfg.thinking_budget = Number.isFinite(budget) && budget >= 1024 ? budget : 10000;
    }
  }

  next.providers[provider] = providerCfg;
  return next;
}

async function persistProviderReasoningPrefs(providerOverride, patch) {
  const provider = providerOverride || window._activeProvider || 'ollama';
  let llm = window._llmSettingsCache || null;
  if (!llm) llm = await refreshReasoningPrefsFromSettings(provider);
  const nextLlm = _buildLlmForReasoningUpdate(llm, provider, patch);
  const data = await api('/api/settings/provider', {
    method: 'POST',
    body: JSON.stringify({ llm: nextLlm }),
  });
  if (data?.success === false) throw new Error(data.error || 'Failed to save provider settings');
  applyReasoningPrefsFromProviderConfig(nextLlm, provider);
  return nextLlm;
}

window.applyReasoningPrefsFromProviderConfig = applyReasoningPrefsFromProviderConfig;
window.refreshReasoningPrefsFromSettings = refreshReasoningPrefsFromSettings;
window.persistProviderReasoningPrefs = persistProviderReasoningPrefs;

function getActiveChatModelRouteSessionId(sessionId = '') {
  return String(sessionId || window.activeChatSessionId || window.agentSessionId || '').trim();
}

async function refreshActiveChatModelRoute(sessionIdOverride = '') {
  const sessionId = getActiveChatModelRouteSessionId(sessionIdOverride);
  if (!sessionId) return null;
  try {
    const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}/model-route`);
    const state = data?.chatModelRoute;
    const route = state?.effective;
    if (!route?.providerId || !route?.model) return state || null;
    const reasoningEffort = _normalizeActiveReasoningEffort(route.providerId, route.model, route.reasoningEffort);
    const isSecondary = sessionId !== String(window.activeChatSessionId || '').trim();
    if (!isSecondary) {
      window._activeProvider = route.providerId;
      window._activeModel = route.model;
      window.reasoningLevel = reasoningEffort;
    }
    _renderActiveModelLabels(route.model, route.providerId, reasoningEffort, isSecondary ? sessionId : '', route.speed || 'standard');
    const follow = isSecondary
      ? Array.from(document.querySelectorAll('[data-model-switcher-follow-default]'))
        .find((node) => String(node.closest('[data-model-switcher-popover]')?.dataset.modelSwitcherSessionId || '') === sessionId)
      : document.getElementById('model-switcher-follow-default');
    if (follow) follow.style.display = state.mode === 'explicit' ? '' : 'none';
    if (!isSecondary) {
      window._activeChatModelRoute = state;
      window._activeChatModelRouteSessionId = sessionId;
    } else {
      if (!window._activeChatModelRoutesBySession) window._activeChatModelRoutesBySession = {};
      window._activeChatModelRoutesBySession[sessionId] = state;
    }
    return state;
  } catch (err) {
    console.warn('refreshActiveChatModelRoute:', err);
    return null;
  }
}

async function setActiveChatModelRoute(route, sessionIdOverride = '') {
  const sessionId = getActiveChatModelRouteSessionId(sessionIdOverride);
  if (!sessionId) throw new Error('No active chat');
  const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}/model-route`, {
    method: 'PUT', body: JSON.stringify(route),
  });
  if (data?.success === false) throw new Error(data.error || 'Could not update this chat model');
  await refreshActiveChatModelRoute(sessionId);
  if (typeof window.scheduleChatContextWindowRefresh === 'function') window.scheduleChatContextWindowRefresh(50);
  return data?.chatModelRoute;
}

async function followMainChatDefault(sessionIdOverride = '') {
  const sessionId = getActiveChatModelRouteSessionId(sessionIdOverride);
  if (!sessionId) return;
  try {
    await api(`/api/sessions/${encodeURIComponent(sessionId)}/model-route`, { method: 'DELETE' });
    await refreshActiveChatModelRoute(sessionId);
    _closeModelSwitcher(sessionId);
  } catch (err) { console.warn('followMainChatDefault:', err); }
}

window.refreshActiveChatModelRoute = refreshActiveChatModelRoute;
window.followMainChatDefault = followMainChatDefault;

const DESKTOP_SWITCHER_EXTRA_MODELS = {
  xai: ['grok-4.6', 'grok-4.5', 'grok-composer-2.5-fast', 'grok-4.3', 'grok-4.3-latest', 'grok-latest', 'grok-4.20-0309-reasoning', 'grok-4.20-0309-non-reasoning', 'grok-4.20-multi-agent-0309', 'grok-build-0.1'],
};

function _desktopSwitcherProviderLabel(id, catalog = []) {
  return catalog.find((item) => item?.id === id)?.name || PROVIDER_LABELS[id] || id;
}

async function _desktopSwitcherModelsFor(provider, state) {
  const models = [];
  const add = (value) => {
    const name = String(value?.name || value || '').trim();
    if (name && !models.includes(name)) models.push(name);
  };
  const catalogItem = state.catalog.find((item) => item?.id === provider);
  (catalogItem?.runtime?.options?.staticModels || []).forEach(add);
  (AMD_STATIC_MODELS[provider] || DESKTOP_SWITCHER_EXTRA_MODELS[provider] || []).forEach(add);
  add(state.llm?.providers?.[provider]?.model);
  if (provider === state.provider) add(state.model);
  if (provider === 'ollama') {
    try { (await api('/api/ollama/models')).models?.forEach((item) => add(item?.name || item)); } catch {}
  }
  return models;
}

async function _loadDesktopSwitcherState(sessionId = '') {
  const [route, settings, catalogData, credentialData] = await Promise.all([
    refreshActiveChatModelRoute(sessionId),
    api('/api/settings/provider').catch(() => null),
    api('/api/extensions/catalog?kind=provider').catch(() => null),
    api('/api/settings/credentialed-model-providers').catch(() => null),
  ]);
  const llm = settings?.llm || window._llmSettingsCache || { provider: window._activeProvider || 'ollama', providers: {} };
  const effective = route?.effective || {};
  const provider = String(effective.providerId || window._activeProvider || llm.provider || 'ollama');
  const model = String(effective.model || llm.providers?.[provider]?.model || window._activeModel || '');
  const providerConfig = { ...(llm.providers?.[provider] || {}), model };
  const credentialed = Array.isArray(credentialData?.providers) ? credentialData.providers.map(String) : [];
  if (provider && !credentialed.includes(provider)) credentialed.unshift(provider);
  const order = Object.keys({ ...AMD_STATIC_MODELS, ...DESKTOP_SWITCHER_EXTRA_MODELS, ollama: [], llama_cpp: [], lm_studio: [] });
  credentialed.sort((a, b) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)));
  return {
    route, llm, catalog: Array.isArray(catalogData?.items) ? catalogData.items : [], credentialed,
    provider, model, providerConfig,
    reasoningEffort: _normalizeActiveReasoningEffort(
      provider,
      model,
      effective.reasoningEffort ?? providerConfig.reasoning_effort,
    ),
    speed: String(effective.speed || providerConfig.speed || (providerConfig.fast_mode === true ? 'fast' : 'standard')).toLowerCase() === 'fast' && _supportsFastSpeed(provider, model) ? 'fast' : 'standard',
  };
}

function _desktopSwitcherController(root = null) {
  const candidate = root instanceof Element
    ? (root.matches('.chat-model-switcher-wrap') ? root : root.closest('.chat-model-switcher-wrap'))
    : null;
  const wrap = candidate || document.getElementById('model-switcher-popover')?.closest('.chat-model-switcher-wrap') || null;
  const scope = wrap || document;
  const popover = scope.querySelector?.('[data-model-switcher-popover]') || document.getElementById('model-switcher-popover');
  return {
    wrap,
    popover,
    main: popover?.querySelector('[data-model-switcher-main]') || document.getElementById('model-switcher-main'),
    detail: popover?.querySelector('[data-model-switcher-detail]') || document.getElementById('model-switcher-detail'),
    sessionId: String(wrap?.closest('[data-composer-session-id]')?.dataset.composerSessionId || '').trim(),
  };
}

function _desktopSwitcherShowDetail(title, body, controller = _desktopSwitcherController()) {
  const detail = controller.detail;
  if (!detail) return;
  detail.hidden = false;
  detail.innerHTML = `<div class="model-switcher-detail-title">${escHtml(title)}</div><div class="model-switcher-options">${body}</div>`;
}

function _desktopSwitcherClearDetail(controller = _desktopSwitcherController()) {
  const detail = controller.detail;
  if (!detail) return;
  detail.hidden = true;
  detail.innerHTML = '';
}

function _desktopSwitcherOption(label, value, selected, attrs = '') {
  return `<button type="button" class="model-switcher-option${selected ? ' selected' : ''}" ${attrs}><span>${escHtml(label)}</span><span class="model-switcher-check">${selected ? '✓' : ''}</span>${value ? `<small>${escHtml(value)}</small>` : ''}</button>`;
}

function mainModelLabel() {
  const composerLabel = document.getElementById('chat-model-name')?.textContent
    ?.replace(/\s+/g, ' ')
    .trim();
  if (composerLabel) return composerLabel;
  return _formatActiveModelLabel(
    window._activeModel || '',
    window._activeProvider || '',
    window.reasoningLevel || '',
  );
}
window.mainModelLabel = mainModelLabel;

function _renderDesktopSwitcherMain(state, controller = _desktopSwitcherController()) {
  const main = controller.main;
  if (!main) return;
  const levels = EFFORT_CAPABLE_PROVIDERS.has(state.provider) ? _effortLevelsForProvider(state.provider, state.model) : [];
  const effort = levels.find((item) => item.v === state.reasoningEffort) || levels[0];
  const speedCapable = _supportsFastSpeed(state.provider, state.model);
  const speed = state.speed === 'fast' ? 'fast' : 'standard';
  const source = state.route?.mode === 'explicit' ? 'This chat' : 'Main Chat default';
  main.innerHTML = `
    <div class="model-switcher-heading">Chat settings</div>
    <button type="button" class="model-switcher-row" data-switcher-view="providers"><span>Providers</span><strong>${escHtml(_desktopSwitcherProviderLabel(state.provider, state.catalog))}</strong><i>›</i></button>
    <button type="button" class="model-switcher-row" data-switcher-view="models"><span>Model</span><strong>${escHtml(typeof window.formatModelDisplayName === 'function' ? window.formatModelDisplayName(state.model, state.provider) : state.model || 'Choose')}</strong><i>›</i></button>
    <button type="button" class="model-switcher-row" data-switcher-view="effort" ${levels.length ? '' : 'disabled'}><span>Effort</span><strong>${escHtml(effort?.label || 'Default')}</strong><i>›</i></button>
    ${speedCapable ? `<button type="button" class="model-switcher-row" data-switcher-view="speed"><span>Speed</span><strong>${speed === 'fast' ? 'Fast' : 'Standard'}</strong><i>›</i></button>` : ''}
    <div class="model-switcher-source">${escHtml(source)}</div>
    ${state.route?.mode==='explicit' ? `<button type=button class="model-switcher-default" data-model-switcher-follow-default>Use Main Chat Default<small>${window.mainModelLabel?.(state)}</small></button>` : ''}`;
  main.querySelector('[data-switcher-view="providers"]')?.addEventListener('click', () => _renderDesktopSwitcherProviders(state, controller));
  main.querySelector('[data-switcher-view="models"]')?.addEventListener('click', () => _renderDesktopSwitcherModels(state, state.provider, controller));
  main.querySelector('[data-switcher-view="effort"]')?.addEventListener('click', () => _renderDesktopSwitcherEffort(state, controller));
  main.querySelector('[data-switcher-view="speed"]')?.addEventListener('click', () => _renderDesktopSwitcherSpeed(state, controller));
  main.querySelector('.model-switcher-default')?.addEventListener('click', () => followMainChatDefault(controller.sessionId));
}

function _renderDesktopSwitcherQuick(state, controller = _desktopSwitcherController()) {
  const main = controller.main;
  if (!main) return;
  const levels = EFFORT_CAPABLE_PROVIDERS.has(state.provider) ? _effortLevelsForProvider(state.provider, state.model) : [];
  const activeIndex = Math.max(0, levels.findIndex((item) => item.v === state.reasoningEffort));
  const effortProgress = levels.length ? (((activeIndex + 0.5) / levels.length) * 100).toFixed(3) : 0;
  const modelLabel = typeof window.formatModelDisplayName === 'function'
    ? window.formatModelDisplayName(state.model, state.provider)
    : state.model || 'Model';
  main.innerHTML = `
    <button type="button" class="model-switcher-advanced" data-switcher-advanced>Advanced <span>›</span></button>
    ${levels.length ? `<div class="model-switcher-effort-slider" style="--effort-progress:${effortProgress}%" role="group" aria-label="Reasoning effort">${levels.map((level, index) => `<button type="button" class="model-switcher-effort-segment${index < activeIndex ? ' filled' : ''}${index === activeIndex ? ' active' : ''}" data-quick-effort="${escHtml(level.v)}" aria-label="${escHtml(level.label)}" aria-pressed="${index === activeIndex ? 'true' : 'false'}"><i></i></button>`).join('')}</div>` : '<div class="model-switcher-quick-empty">This model has no adjustable reasoning level.</div>'}
    <div class="model-switcher-quick-label"><strong>${escHtml(modelLabel)}</strong><span>${escHtml(levels[activeIndex]?.label || 'Default')}</span><i>⌄</i></div>`;
  const advancedButton = main.querySelector('[data-switcher-advanced]');
  const openAdvanced = (event) => {
    event?.preventDefault();
    event?.stopPropagation();
    _desktopSwitcherClearDetail(controller);
    _renderDesktopSwitcherMain(state, controller);
  };
  // The composer has outside-click handling of its own. Open on pointer-down
  // and suppress the follow-up click so that handler cannot consume Advanced
  // before the panel is swapped. Keep click for keyboard activation.
  advancedButton?.addEventListener('pointerdown', openAdvanced);
  advancedButton?.addEventListener('click', openAdvanced);
  const slider = main.querySelector('.model-switcher-effort-slider');
  const quickEffortButtons = [...main.querySelectorAll('[data-quick-effort]')];
  let previewIndex = activeIndex;
  let isDragging = false;
  let suppressPointerClick = false;
  const updateEffortPreview = (index) => {
    const nextIndex = Math.max(0, Math.min(levels.length - 1, index));
    if (previewIndex === nextIndex) return;
    previewIndex = nextIndex;
    const progress = (((nextIndex + 0.5) / levels.length) * 100).toFixed(3);
    if (slider) slider.style.setProperty('--effort-progress', `${progress}%`);
    quickEffortButtons.forEach((button, buttonIndex) => {
      const selected = buttonIndex === nextIndex;
      button.classList.toggle('active', selected);
      button.classList.toggle('filled', buttonIndex < nextIndex);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    const label = main.querySelector('.model-switcher-quick-label span');
    if (label) label.textContent = levels[nextIndex]?.label || 'Default';
  };
  const effortIndexForPointer = (clientX) => {
    if (!slider || levels.length < 2) return 0;
    const rect = slider.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return Math.round(progress * (levels.length - 1));
  };
  const saveQuickEffort = async (index) => {
    const effort = levels[index]?.v || '';
    if (!effort || index === activeIndex) return;
    try {
      await setActiveChatModelRoute({ providerId: state.provider, model: state.model, reasoningEffort: effort || undefined, speed: state.speed }, controller.sessionId);
      _renderDesktopSwitcherQuick(await _loadDesktopSwitcherState(controller.sessionId), controller);
    } catch (err) { showToast('Could not save reasoning effort', String(err?.message || err), 'error'); }
  };
  if (slider) {
    slider.addEventListener('pointerdown', (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      isDragging = true;
      suppressPointerClick = true;
      slider.classList.add('is-dragging');
      slider.setPointerCapture?.(event.pointerId);
      updateEffortPreview(effortIndexForPointer(event.clientX));
    });
    slider.addEventListener('pointermove', (event) => {
      if (isDragging) updateEffortPreview(effortIndexForPointer(event.clientX));
    });
    slider.addEventListener('pointerup', async (event) => {
      if (!isDragging) return;
      isDragging = false;
      slider.classList.remove('is-dragging');
      if (slider.hasPointerCapture?.(event.pointerId)) slider.releasePointerCapture(event.pointerId);
      await saveQuickEffort(previewIndex);
    });
    slider.addEventListener('pointercancel', (event) => {
      if (!isDragging) return;
      isDragging = false;
      suppressPointerClick = false;
      slider.classList.remove('is-dragging');
      if (slider.hasPointerCapture?.(event.pointerId)) slider.releasePointerCapture(event.pointerId);
      updateEffortPreview(activeIndex);
    });
  }
  quickEffortButtons.forEach((button, index) => button.addEventListener('click', async (event) => {
    if (suppressPointerClick) {
      suppressPointerClick = false;
      event.preventDefault();
      return;
    }
    updateEffortPreview(index);
    await saveQuickEffort(index);
  }));
}

async function _renderDesktopSwitcherProviders(state, controller = _desktopSwitcherController()) {
  if (!state.credentialed.length) {
    _desktopSwitcherShowDetail('Providers', '<div class="model-switcher-empty">No providers with saved credentials.</div>', controller);
    return;
  }
  _desktopSwitcherShowDetail('Providers', state.credentialed.map((id) => _desktopSwitcherOption(
    _desktopSwitcherProviderLabel(id, state.catalog), '', id === state.provider, `data-switcher-provider="${escHtml(id)}"`,
  )).join(''), controller);
  controller.detail?.querySelectorAll('[data-switcher-provider]').forEach((button) => button.addEventListener('click', async () => {
    const provider = button.getAttribute('data-switcher-provider') || '';
    const models = await _desktopSwitcherModelsFor(provider, state);
    const model = String(state.llm?.providers?.[provider]?.model || models[0] || '');
    if (!model) return _renderDesktopSwitcherModels(state, provider, controller);
    try {
      await setActiveChatModelRoute({ providerId: provider, model, reasoningEffort: undefined }, controller.sessionId);
      const next = await _loadDesktopSwitcherState(controller.sessionId);
      _renderDesktopSwitcherMain(next, controller);
      _renderDesktopSwitcherModels(next, provider, controller);
    } catch (err) { showToast('Could not switch provider', String(err?.message || err), 'error'); }
  }));
}

async function _renderDesktopSwitcherModels(state, provider, controller = _desktopSwitcherController()) {
  _desktopSwitcherShowDetail('Model', '<div class="model-switcher-empty">Loading models…</div>', controller);
  const models = await _desktopSwitcherModelsFor(provider, state);
  _desktopSwitcherShowDetail('Model', models.length ? models.map((model) => _desktopSwitcherOption(
    typeof window.formatModelDisplayName === 'function' ? window.formatModelDisplayName(model, provider) : model,
    '', provider === state.provider && model === state.model, `data-switcher-model="${escHtml(model)}"`,
  )).join('') : '<div class="model-switcher-empty">No models are available for this provider.</div>', controller);
  controller.detail?.querySelectorAll('[data-switcher-model]').forEach((button) => button.addEventListener('click', async () => {
    const model = button.getAttribute('data-switcher-model') || '';
    if (!model) return;
    try {
      await setActiveChatModelRoute({ providerId: provider, model, reasoningEffort: provider === state.provider ? state.reasoningEffort || undefined : undefined, speed: provider === state.provider ? state.speed : undefined }, controller.sessionId);
      const next = await _loadDesktopSwitcherState(controller.sessionId);
      _renderDesktopSwitcherMain(next, controller);
      _renderDesktopSwitcherEffort(next, controller);
    } catch (err) { showToast('Could not switch model', String(err?.message || err), 'error'); }
  }));
}

function _renderDesktopSwitcherEffort(state, controller = _desktopSwitcherController()) {
  const levels = EFFORT_CAPABLE_PROVIDERS.has(state.provider) ? _effortLevelsForProvider(state.provider, state.model) : [];
  _desktopSwitcherShowDetail('Effort', levels.map((level) => _desktopSwitcherOption(
    level.label, level.desc, level.v === state.reasoningEffort, `data-switcher-effort="${escHtml(level.v)}"`,
  )).join(''), controller);
  controller.detail?.querySelectorAll('[data-switcher-effort]').forEach((button) => button.addEventListener('click', async () => {
    const effort = button.getAttribute('data-switcher-effort') || '';
    try {
      await setActiveChatModelRoute({ providerId: state.provider, model: state.model, reasoningEffort: effort || undefined, speed: state.speed }, controller.sessionId);
      const next = await _loadDesktopSwitcherState(controller.sessionId);
      _renderDesktopSwitcherMain(next, controller);
      _renderDesktopSwitcherEffort(next, controller);
    } catch (err) { showToast('Could not save reasoning effort', String(err?.message || err), 'error'); }
  }));
}

function _renderDesktopSwitcherSpeed(state, controller = _desktopSwitcherController()) {
  if (!_supportsFastSpeed(state.provider, state.model)) {
    _renderDesktopSwitcherMain(state, controller);
    return;
  }
  const options = [
    { v: 'standard', label: 'Standard' },
    { v: 'fast', label: 'Fast' },
  ];
  _desktopSwitcherShowDetail('Speed', options.map((option) => _desktopSwitcherOption(
    option.label, '', option.v === state.speed, `data-switcher-speed="${option.v}"`,
  )).join(''), controller);
  controller.detail?.querySelectorAll('[data-switcher-speed]').forEach((button) => button.addEventListener('click', async () => {
    const speed = button.getAttribute('data-switcher-speed') === 'fast' ? 'fast' : 'standard';
    try {
      await setActiveChatModelRoute({ providerId: state.provider, model: state.model, reasoningEffort: state.reasoningEffort || undefined, speed }, controller.sessionId);
      const next = await _loadDesktopSwitcherState(controller.sessionId);
      _renderDesktopSwitcherMain(next, controller);
      _renderDesktopSwitcherSpeed(next, controller);
    } catch (err) { showToast('Could not save model speed', String(err?.message || err), 'error'); }
  }));
}

async function toggleModelSwitcher() {
  const controller = _desktopSwitcherController();
  const popover = controller.popover;
  if (!popover) return;
  _modelSwitcherOpen = !_modelSwitcherOpen;
  if (!_modelSwitcherOpen) { _closeModelSwitcher(controller); return; }
  popover.style.display = 'flex';
  _desktopSwitcherClearDetail(controller);
  const main = controller.main;
  if (main) main.innerHTML = '<div class="model-switcher-loading">Loading controls…</div>';
  try { _renderDesktopSwitcherQuick(await _loadDesktopSwitcherState(controller.sessionId), controller); }
  catch (err) { if (main) main.innerHTML = `<div class="model-switcher-empty">${escHtml(String(err?.message || 'Could not load model controls.'))}</div>`; }
}

function _closeModelSwitcher(sessionIdOrController = '') {
  const controller = sessionIdOrController && typeof sessionIdOrController === 'object'
    ? sessionIdOrController
    : sessionIdOrController
      ? _desktopSwitcherController(Array.from(document.querySelectorAll('[data-model-switcher-popover]'))
        .find((node) => String(node.dataset.modelSwitcherSessionId || '') === String(sessionIdOrController))?.closest('.chat-model-switcher-wrap'))
      : _desktopSwitcherController();
  const popover = controller.popover;
  if (popover) popover.style.display = 'none';
  if (!controller.sessionId) _modelSwitcherOpen = false;
}

async function toggleDesktopComposerModelSwitcher(event, button) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const controller = _desktopSwitcherController(button);
  if (!controller.sessionId || !controller.popover) return;
  const isOpen = controller.popover.style.display !== 'none';
  document.querySelectorAll('[data-model-switcher-popover="1"]').forEach((popover) => {
    popover.style.display = 'none';
  });
  if (isOpen) return;
  controller.popover.style.display = 'flex';
  _desktopSwitcherClearDetail(controller);
  if (controller.main) controller.main.innerHTML = '<div class="model-switcher-loading">Loading controls…</div>';
  try {
    _renderDesktopSwitcherQuick(await _loadDesktopSwitcherState(controller.sessionId), controller);
  } catch (err) {
    if (controller.main) controller.main.innerHTML = `<div class="model-switcher-empty">${escHtml(String(err?.message || 'Could not load model controls.'))}</div>`;
  }
}

async function switchModel(modelName) {
  _closeModelSwitcher();
  try {
    const state = window._activeChatModelRoute || await refreshActiveChatModelRoute();
    const route = state?.effective || {};
    await setActiveChatModelRoute({ providerId: route.providerId || window._activeProvider || 'ollama', model: modelName, reasoningEffort: route.reasoningEffort || undefined, speed: route.speed || undefined, accountId: route.accountId || undefined });
  } catch {
    // The next header refresh will retain the currently admitted/global route.
  }
}

function setReasoningLevel(level) {
  window.reasoningLevel = level;
  try { localStorage.setItem('prometheus.reasoningLevel', level); } catch {}
  _closeModelSwitcher();
  const rawModel = document.getElementById('chat-model-name')?.dataset?.rawModel || window._activeModel || '';
  _renderActiveModelLabels(rawModel, window._activeProvider || '', level);
}

function setAnthropicThinking(enabled) {
  window.anthropicExtendedThinking = !!enabled;
  try { localStorage.setItem('prometheus.anthropicExtendedThinking', enabled ? '1' : '0'); } catch {}
  _closeModelSwitcher();
}

function setAnthropicBudget(budget) {
  window.anthropicThinkingBudget = Number(budget) || 10000;
  try { localStorage.setItem('prometheus.anthropicThinkingBudget', String(window.anthropicThinkingBudget)); } catch {}
  _closeModelSwitcher();
}

// Hydrate from localStorage on load
(function hydrateModelSwitcherPrefs() {
  try {
    const r = localStorage.getItem('prometheus.reasoningLevel');
    if (r) window.reasoningLevel = r;
    const t = localStorage.getItem('prometheus.anthropicExtendedThinking');
    if (t !== null) window.anthropicExtendedThinking = t === '1';
    const b = localStorage.getItem('prometheus.anthropicThinkingBudget');
    if (b) window.anthropicThinkingBudget = Number(b) || 10000;
  } catch {}
})();

async function setReasoningLevel(level) {
  const provider = window._activeProvider || 'openai';
  try {
    if (provider === 'anthropic') {
      const llm = window._llmSettingsCache || await refreshReasoningPrefsFromSettings(provider);
      const model = _activeModelForProvider(provider, llm);
      if (!_supportsAnthropicEffort(model)) {
        window.reasoningLevel = '';
        _closeModelSwitcher();
        return;
      }
      if (level === 'xhigh' && !_supportsAnthropicXHigh(model)) level = 'high';
    }
    const state = window._activeChatModelRoute || await refreshActiveChatModelRoute();
    const route = state?.effective || {};
    await setActiveChatModelRoute({ providerId: route.providerId || provider, model: route.model || window._activeModel || '', reasoningEffort: level || undefined, speed: route.speed || undefined, accountId: route.accountId || undefined });
    _closeModelSwitcher();
  } catch (err) {
    console.warn('setReasoningLevel:', err);
  }
}

async function setAnthropicThinking(enabled) {
  try {
    await persistProviderReasoningPrefs('anthropic', { extended_thinking: !!enabled });
    _closeModelSwitcher();
  } catch (err) {
    console.warn('setAnthropicThinking:', err);
  }
}

async function setAnthropicBudget(budget) {
  try {
    await persistProviderReasoningPrefs('anthropic', { thinking_budget: Number(budget) || 10000 });
    _closeModelSwitcher();
  } catch (err) {
    console.warn('setAnthropicBudget:', err);
  }
}

// Close model switcher on outside click
document.addEventListener('click', (e) => {
  if (_modelSwitcherOpen) {
    const btn = document.getElementById('model-switcher-btn');
    const pop = document.getElementById('model-switcher-popover');
    if (btn && pop && !btn.contains(e.target) && !pop.contains(e.target)) {
      pop.style.display = 'none';
      _modelSwitcherOpen = false;
    }
  }
  document.querySelectorAll('[data-model-switcher-popover="1"]').forEach((pop) => {
    const wrap = pop.closest('.chat-model-switcher-wrap');
    const button = wrap?.querySelector('button');
    if (wrap && !wrap.contains(e.target) && button && !button.contains(e.target)) pop.style.display = 'none';
  });
});

// ---- Select job ----
async function selectJob(jobId) {
  selectedJobId = jobId;
  setMode('chat');
  renderJobsList(allJobs);
  await refreshJobDetail(jobId);
  clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    const job = allJobs.find(j => j.id === jobId);
    if (job && ['planning', 'executing', 'verifying'].includes(job.status)) {
      await refreshJobDetail(jobId);
    } else {
      clearInterval(pollInterval);
    }
  }, 2000);
}

async function refreshJobDetail(jobId) {
  try {
    const data = await api(`/api/jobs/${jobId}`);
    renderJobDetail(data);
  } catch {}
}

function renderJobDetail(data) {
  const { job, tasks, artifacts, state } = data;
  const content = document.getElementById('main-content');
  const isRunning = ['planning','executing','verifying'].includes(job.status);

  content.innerHTML = `
    <div class="job-detail-title">${escHtml(job.title)}</div>
    <div class="job-detail-meta">
      <span class="badge badge-${job.status}">${isRunning ? '<span class="spinner"></span>' : ''}${job.status}</span>
      <span>ID: ${job.id.slice(0, 12)}...</span>
      <span>${timeAgo(job.created_at)}</span>
    </div>

    ${state ? `
    <div class="section-title">Mission</div>
    <div style="color:var(--muted);font-size:12px;line-height:1.7;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:16px">
      ${escHtml(state.mission)}
    </div>` : ''}

    ${tasks && tasks.length > 0 ? `
    <div class="section-title">Tasks (${tasks.length})</div>
    ${tasks.map(t => `
      <div class="task-card">
        <div class="task-card-header">
          <span class="task-card-title">${escHtml(t.title)}</span>
          <span class="badge badge-${t.status}">${t.status}</span>
        </div>
        <div class="task-card-desc">${escHtml(t.description || '')}</div>
        ${t.acceptance_criteria && t.acceptance_criteria.length > 0 ? `
        <div class="task-criteria">
          ${t.acceptance_criteria.map(c => `<div class="task-criteria-item">${escHtml(c)}</div>`).join('')}
        </div>` : ''}
      </div>
    `).join('')}` : `
    <div class="section-title">Tasks</div>
    <div style="color:var(--muted);font-size:12px;padding:20px 0">
      ${isRunning ? '<span class="spinner pulsing"></span> Planning tasks...' : 'No tasks'}
    </div>`}

    ${artifacts && artifacts.length > 0 ? `
    <div class="section-title" style="margin-top:16px">Artifacts (${artifacts.length})</div>
    ${artifacts.map(a => `
      <div class="task-card">
        <div class="task-card-header">
          <span class="task-card-title">${escHtml(a.path || a.type)}</span>
          <span class="badge badge-completed">${a.type}</span>
        </div>
        ${a.content ? `<div class="task-card-desc" style="margin-top:6px">${escHtml(a.content.slice(0, 200))}${a.content.length > 200 ? '...' : ''}</div>` : ''}
      </div>
    `).join('')}` : ''}

    <div id="log-panel">${logLines.map(l => `<div class="log-line ${l.type}">${l.text}</div>`).join('')}</div>
  `;

  const lp = document.getElementById('log-panel');
  if (lp) lp.scrollTop = lp.scrollHeight;
}

// ---- Stats ----
function updateStats(jobs) {
  const totalEl = document.getElementById('r-total');
  const runningEl = document.getElementById('r-running');
  const modeEl = document.getElementById('r-completed');
  if (totalEl) totalEl.textContent = String(chatSessions.length);
  if (runningEl) runningEl.textContent = activeChatSessionId ? '1' : '0';
  if (modeEl) modeEl.textContent = useAgentMode ? 'On' : 'Off';
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5 — SESSION APPROVAL CARDS (right column) + AUDIT LOG PAGE
// ═══════════════════════════════════════════════════════════════════════════

// ─── Approval Cards ───────────────────────────────────────────────────────────

const RISK_COLORS = {
  low:    { bg: '#f0fdf4', border: '#86efac', text: '#166534', badge: '#dcfce7' },
  medium: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e', badge: '#fef3c7' },
  high:   { bg: '#fff1f2', border: '#fca5a5', text: '#991b1b', badge: '#fee2e2' },
};
const TIER_COLORS = {
  propose: { bg: '#fff7ed', text: '#9a3412', border: '#fdba74' },
  commit:  { bg: '#fdf2f8', text: '#7e22ce', border: '#e879f9' },
};

function riskLevel(score) {
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

function renderApprovalCard(p) {
  const risk = riskLevel(p.riskScore ?? 0);
  const rc = RISK_COLORS[risk];
  const tier = (p.policyTier || 'propose').toLowerCase();
  const tc = TIER_COLORS[tier] || TIER_COLORS.propose;
  const systems = Array.isArray(p.affectedSystems) ? p.affectedSystems : [];
  const summary = p.summary || p.toolArgs
    ? (p.summary || JSON.stringify(p.toolArgs || {}).slice(0, 80))
    : '';
  const isProposal = !!p.sourceAgentId; // from proposal-store
  const title = p.title || p.toolName || 'Action requires review';
  const approveEndpoint = isProposal ? `/api/proposals/${p.id}/approve` : `/api/approvals/${p.id}`;
  const denyEndpoint = isProposal ? `/api/proposals/${p.id}/deny` : `/api/approvals/${p.id}`;
  const denyBody = isProposal ? '{}' : JSON.stringify({ decision: 'rejected' });
  const approveBody = isProposal ? '{}' : JSON.stringify({ decision: 'approved' });
  const approveSessionBody = JSON.stringify({ decision: 'approved', grantScope: 'session' });
  const approveAlwaysBody = JSON.stringify({ decision: 'approved', grantScope: 'always' });
  const pathAccessPaths = Array.from(new Set([
    p.pathAccess?.requestedPath,
    ...(Array.isArray(p.pathAccess?.requestedPaths) ? p.pathAccess.requestedPaths : []),
  ].map((value) => String(value || '').trim()).filter(Boolean)));
  const isPathAccess = !isProposal && pathAccessPaths.length > 0;

  return `<div class="approval-card" style="background:${rc.bg};border-color:${rc.border};padding:10px 12px">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
      <div style="font-size:12px;font-weight:700;color:${rc.text};flex:1;line-height:1.3">${escHtml(title)}</div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        <span style="font-size:9px;font-weight:800;padding:2px 6px;border-radius:999px;background:${tc.bg};color:${tc.text};border:1px solid ${tc.border};text-transform:uppercase;letter-spacing:0.05em">${tier}</span>
        <span style="font-size:9px;font-weight:800;padding:2px 6px;border-radius:999px;background:${rc.badge};color:${rc.text};text-transform:uppercase;letter-spacing:0.05em">risk ${p.riskScore ?? '?'}</span>
      </div>
    </div>
    ${summary ? `<div style="font-size:11px;color:${rc.text};margin-bottom:6px;line-height:1.4;opacity:0.9">${escHtml(String(summary).slice(0, 120))}</div>` : ''}
    ${isPathAccess ? `<div style="font-size:10px;color:${rc.text};margin:-1px 0 8px;line-height:1.35"><strong>Requested path${pathAccessPaths.length === 1 ? '' : 's'}:</strong><br>${pathAccessPaths.slice(0, 8).map((value) => escHtml(value)).join('<br>')}</div>` : ''}
    ${systems.length ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:7px">${systems.map(s => `<span style="font-size:9px;background:rgba(255,255,255,0.72);color:${rc.text};border:1px solid ${rc.border};border-radius:4px;padding:1px 5px;font-family:monospace">${escHtml(s)}</span>`).join('')}</div>` : ''}
    ${isPathAccess
      ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <button onclick="resolveSessionApproval('${p.id}','approve','${escHtml(approveEndpoint)}','${escHtml(approveBody).replace(/'/g,'&#39;')}')" style="border:none;background:#16a34a;color:#fff;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer">Approve</button>
        <button onclick="resolveSessionApproval('${p.id}','approve_session','${escHtml(approveEndpoint)}','${escHtml(approveSessionBody).replace(/'/g,'&#39;')}')" style="border:none;background:#0f766e;color:#fff;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer">Allow this session</button>
        <button onclick="resolveSessionApproval('${p.id}','approve_always','${escHtml(approveEndpoint)}','${escHtml(approveAlwaysBody).replace(/'/g,'&#39;')}')" style="border:none;background:#2563eb;color:#fff;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer">Always allow path</button>
        <button onclick="resolveSessionApproval('${p.id}','deny','${escHtml(denyEndpoint)}','${escHtml(denyBody).replace(/'/g,'&#39;')}')" style="border:1px solid ${rc.border};background:transparent;color:${rc.text};border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer">✗ Deny</button>
      </div>`
      : `<div style="display:flex;gap:6px">
        <button onclick="resolveSessionApproval('${p.id}','approve','${escHtml(approveEndpoint)}','${escHtml(approveBody).replace(/'/g,'&#39;')}')" style="flex:1;border:none;background:#16a34a;color:#fff;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer">✓ Approve</button>
        <button onclick="resolveSessionApproval('${p.id}','deny','${escHtml(denyEndpoint)}','${escHtml(denyBody).replace(/'/g,'&#39;')}')" style="flex:1;border:1px solid ${rc.border};background:transparent;color:${rc.text};border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer">✗ Deny</button>
      </div>`}
  </div>`;
}

async function loadSessionApprovals() {
  const list = document.getElementById('session-approvals-list');
  const badge = document.getElementById('session-approvals-badge');
  const section = document.getElementById('session-approvals-section');
  if (!list) return;
  if (section) section.style.display = 'none';
  const currentSessionId = window.activeChatSessionId || '';
  try {
    // Fetch pending approvals and proposals — both filtered to this chat session
    const [approvalData, proposalData] = await Promise.all([
      api('/api/approvals?status=pending').catch(() => ({ approvals: [] })),
      api(`/api/proposals?status=pending&sessionId=${encodeURIComponent(currentSessionId)}`).catch(() => ({ proposals: [] })),
    ]);
    // Normalise both into a common shape
    // Filter approvals to only those originating from the current chat session
    const approvalItems = (approvalData.approvals || [])
      .filter(a => a.sessionId && a.sessionId === currentSessionId)
      .map(a => ({
        id: a.id,
        title: a.action || a.toolName || 'Action required',
        summary: a.reason || '',
        policyTier: a.policyTier || 'commit',
        riskScore: a.riskScore ?? 8,
        affectedSystems: a.affectedSystems || [],
        toolArgs: a.toolArgs,
        toolName: a.toolName,
        approvalKind: a.approvalKind,
        pathAccess: a.pathAccess,
        oneShot: a.oneShot,
        sourceAgentId: null, // not a proposal-store item
      }));
    const proposalItems = (proposalData.proposals || []).filter(p => !currentSessionId || p.sourceSessionId === currentSessionId).map(p => ({
      id: p.id,
      title: p.title,
      summary: p.summary,
      policyTier: p.type === 'src_edit' || p.type === 'config_change' ? 'commit' : 'propose',
      riskScore: p.priority === 'critical' ? 10 : p.priority === 'high' ? 7 : p.priority === 'medium' ? 4 : 2,
      affectedSystems: (p.affectedFiles || []).map(f => f.path?.split(/[\/]/).pop() || f.path || '').filter(Boolean),
      summary: p.summary,
      sourceAgentId: p.sourceAgentId || 'agent',
    }));

    const all = [...approvalItems, ...proposalItems];
    const inlineStreamOwnsApprovals = Boolean(
      currentSessionId
      && window._sessionThinking?.[currentSessionId]
      && approvalItems.length
    );
    if (inlineStreamOwnsApprovals) {
      if (section) section.style.display = 'none';
      list.innerHTML = '';
      if (badge) {
        badge.style.display = 'inline-block';
        badge.textContent = String(all.length);
      }
      return;
    }

    if (!all.length) {
      list.innerHTML = '<div style="font-size:11px;color:var(--muted);text-align:center;padding:12px 0;opacity:0.6">No pending actions</div>';
      badge.style.display = 'none';
      return;
    }

    list.innerHTML = all.map(renderApprovalCard).join('');
    badge.style.display = 'inline-block';
    badge.textContent = String(all.length);
  } catch(e) {
    list.innerHTML = `<div style="font-size:11px;color:var(--err);padding:8px 0">${escHtml(e.message || 'Load failed')}</div>`;
  }
}

async function resolveSessionApproval(id, action, endpoint, bodyStr) {
  try {
    const body = bodyStr.replace(/&#39;/g, "'");
    const method = action === 'approve' ? 'POST' : 'POST';
    await api(endpoint, { method, body });
    // Refresh both right-column panel and proposals page
    loadSessionApprovals();
    if (currentMode === 'proposals') loadProposals();
    checkPendingProposalsBadge();
    addProcessEntry('info', `${action === 'approve' ? '✓ Approved' : '✗ Denied'}: ${id}`);
  } catch(e) {
    showToast('Error', e.message || 'Could not resolve action', 'error');
  }
}

// Legacy shim — kept for any old inline calls
async function loadApprovals() { return loadSessionApprovals(); }
async function resolveApproval(id, decision) {
  await api(`/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision }) });
  loadSessionApprovals();
}

let systemStatsFetchInFlight = false;
let lastSystemStatsOkAt = 0;
async function loadSystemStats() {
  if (systemStatsFetchInFlight) return;
  systemStatsFetchInFlight = true;
  try {
    const stats = await api('/api/system-stats', { timeoutMs: 10000 });
    const cpu = stats?.system?.cpu_percent;
    const ram = stats?.system?.memory_percent;
    const gpu = stats?.gpu?.gpu_util_percent;
    const vram = stats?.gpu?.vram_used_percent;
    const gpuAvailable = !!stats?.gpu?.available;
    lastSystemStatsOkAt = Date.now();

    setText('quick-system-stats', `CPU ${fmtPercent(cpu)} • RAM ${fmtPercent(ram)} • GPU ${gpuAvailable ? fmtPercent(gpu) : '--%'}`);

    setText('sys-cpu', fmtPercent(cpu));
    setText('sys-ram', fmtPercent(ram));
    setText('sys-gpu', gpuAvailable ? fmtPercent(gpu) : 'N/A');
    setText('sys-vram', gpuAvailable ? fmtPercent(vram) : 'N/A');
    setMeter('sys-cpu-meter', cpu);
    setMeter('sys-ram-meter', ram);
    setMeter('sys-gpu-meter', gpuAvailable ? gpu : 0);
    setMeter('sys-vram-meter', gpuAvailable ? vram : 0);

    const ollamaRunning = !!stats?.ollama_process?.running;
    const ollamaCount = Number(stats?.ollama_process?.process_count || 0);
    const ollamaMemMb = Number(stats?.ollama_process?.total_memory_mb || 0);
    const gatewayRss = Number(stats?.gateway_process?.rss_mb || 0);
    const gpuName = String(stats?.gpu?.name || '').trim();
    const memUsage = fmtMemoryGb(stats?.system?.memory_used_gb, stats?.system?.memory_total_gb);
    const updated = new Date(stats?.timestamp || Date.now()).toLocaleTimeString();
    const activeProvider = stats?.active_provider || 'ollama';
    const activeModel = stats?.active_model || document.getElementById('current-model')?.textContent || '-';
    const isLocalProvider = activeProvider === 'ollama' || activeProvider === 'llama_cpp' || activeProvider === 'lm_studio';

    // Show provider + model in the runtime card
    const providerDisp = (PROVIDER_LABELS[activeProvider] || activeProvider);
    let runtimeLabel;
    if (activeProvider === 'ollama') {
      runtimeLabel = ollamaRunning ? `Ollama • ${activeModel}` : `Ollama offline • ${activeModel}`;
    } else {
      runtimeLabel = `${providerDisp} • ${activeModel}`;
    }
    setText('sys-ollama', runtimeLabel);
    const memPart = isLocalProvider && ollamaMemMb > 0 ? ` • LLM ${ollamaMemMb.toFixed(0)} MB` : '';
    setText(
      'sys-runtime-sub',
      `${memUsage}${memPart} • Gateway ${gatewayRss.toFixed(0)} MB${gpuName ? ` • ${gpuName}` : ''} • ${updated}`
    );
  } catch {
    if (lastSystemStatsOkAt && (window.isThinking || Date.now() - lastSystemStatsOkAt < 60_000)) return;
    setText('quick-system-stats', 'CPU --% • RAM --% • GPU --%');
    setText('sys-cpu', '--%');
    setText('sys-ram', '--%');
    setText('sys-gpu', 'N/A');
    setText('sys-vram', 'N/A');
    setText('sys-ollama', 'Stats unavailable');
    setText('sys-runtime-sub', 'Could not fetch system stats right now');
    setMeter('sys-cpu-meter', 0);
    setMeter('sys-ram-meter', 0);
    setMeter('sys-gpu-meter', 0);
    setMeter('sys-vram-meter', 0);
  } finally {
    systemStatsFetchInFlight = false;
  }
}

// ---- Status ----
const PROVIDER_LABELS = {
  ollama: 'Ollama', llama_cpp: 'llama.cpp', lm_studio: 'LM Studio',
  openai: 'OpenAI', openai_codex: 'ChatGPT', anthropic: 'Claude',
  perplexity: 'Perplexity', gemini: 'Gemini'
};
let statusFetchInFlight = false;
let lastStatusOkAt = 0;
async function checkStatus() {
  if (statusFetchInFlight) return;
  statusFetchInFlight = true;
  try {
    const status = await api('/api/status', { timeoutMs: 10000 });
    const provider = status.provider || 'ollama';
    const providerLabel = PROVIDER_LABELS[provider] || provider;
    const isCloud = provider === 'openai' || provider === 'openai_codex' || provider === 'anthropic' || provider === 'perplexity' || provider === 'gemini';
    window._activeProvider = provider;
    const dot = document.getElementById('ollama-dot');

    // For cloud providers, always show as online if gateway is up
	    const providerChecking = !!status.providerChecking;
	    const backendOnline = isCloud ? true : (status.providerOnline !== undefined ? !!status.providerOnline : !!status.ollama);
	    if (dot) dot.className = providerChecking ? 'dot' : 'dot ' + (backendOnline ? 'online' : 'offline');
	    const statusEl = document.getElementById('ollama-status');
	    if (statusEl) statusEl.textContent = providerChecking
	      ? 'Checking...'
	      : (backendOnline ? 'Online' : 'Offline');
	    const ro = document.getElementById('r-ollama');
	    if (ro) {
	      ro.textContent = providerChecking ? 'Checking...' : (backendOnline ? 'Online' : 'Offline');
	      ro.className = 'info-val ' + (providerChecking ? '' : (backendOnline ? 'green' : 'red'));
	    }

    // The status endpoint reports the global default. Keep an explicit
    // per-chat route authoritative so its reasoning label cannot flicker away
    // whenever the periodic status refresh runs.
    const activeRoute = String(window._activeChatModelRouteSessionId || '') === String(window.activeChatSessionId || '')
      ? window._activeChatModelRoute?.effective
      : null;
    const modelName = String(activeRoute?.model || status.currentModel || '-');
	    const displayProvider = String(activeRoute?.providerId || provider);
	    const reasoningEffort = String(activeRoute?.reasoningEffort ?? status.reasoningEffort ?? '').trim();
	    window._activeProvider = displayProvider;
	    window._activeModel = modelName;
	    _renderActiveModelLabels(modelName, displayProvider, reasoningEffort);
	    const badge = document.getElementById('current-provider-badge');
	    if (badge) badge.textContent = isCloud ? providerLabel.toUpperCase() : '';
	    const cpn = document.getElementById('chat-provider-name');
	    if (cpn) cpn.textContent = providerLabel;
      if (typeof window.refreshChatContextWindow === 'function') window.refreshChatContextWindow().catch(() => {});
      if (window._llmSettingsCache && !activeRoute) applyReasoningPrefsFromProviderConfig(window._llmSettingsCache, provider);
      lastStatusOkAt = Date.now();
	  } catch {
    if (lastStatusOkAt && (window.isThinking || Date.now() - lastStatusOkAt < 60_000)) return;
    const dot = document.getElementById('ollama-dot');
    if (dot) dot.className = 'dot offline';
    const statusEl = document.getElementById('ollama-status');
    if (statusEl) statusEl.textContent = 'Gateway warming...';
  } finally {
    statusFetchInFlight = false;
  }
}

// --- Agent Model Defaults --------------------------------------------------

// Slot IDs → API field names
const AMD_SLOTS = {
  'main-chat':       'main_chat',
  'proposal-high':   'proposal_executor_high_risk',
  'proposal-low':    'proposal_executor_low_risk',
  'manager':         'manager',
  'background-task':  'background_task',
  'background-spawn': 'background_spawn',
};

// Static model fallbacks (mirrors what loadAgentModelOptions uses)
const AMD_STATIC_MODELS = {
  openai:       ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-pro', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-chat-latest', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3', 'o1'],
  openai_codex: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-codex', 'gpt-5.4-codex-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.3', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini', 'gpt-5.1-codex', 'gpt-5.1'],
  anthropic:    ['claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  perplexity:   ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning', 'sonar-deep-research'],
  gemini:       ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
};

async function amdProviderChange(slotId) {
  const provSel  = document.getElementById('amd-' + slotId + '-prov');
  const modelSel = document.getElementById('amd-' + slotId + '-model');
  if (!provSel || !modelSel) return;
  const prov = provSel.value;
  if (!prov) {
    modelSel.innerHTML = '<option value="">use primary</option>';
    return;
  }
  modelSel.innerHTML = '<option value="">Loading…</option>';
  try {
    let models = [];
    if (prov === 'openai') {
      models = Array.from(document.getElementById('settings-openai-model')?.options || []).map(o => o.value).filter(Boolean);
      if (!models.length) { try { await refreshOpenAIModels(true); } catch {} models = Array.from(document.getElementById('settings-openai-model')?.options || []).map(o => o.value).filter(Boolean); }
      if (!models.length) models = [...(AMD_STATIC_MODELS.openai)];
    } else if (prov === 'openai_codex') {
      models = Array.from(document.getElementById('settings-codex-model')?.options || []).map(o => o.value).filter(Boolean);
      if (!models.length) models = [...(AMD_STATIC_MODELS.openai_codex)];
    } else if (prov === 'anthropic') {
      models = Array.from(document.getElementById('settings-anthropic-model')?.options || []).map(o => o.value).filter(Boolean);
      if (!models.length) models = [...(AMD_STATIC_MODELS.anthropic)];
    } else if (prov === 'perplexity') {
      models = Array.from(document.getElementById('settings-perplexity-model')?.options || []).map(o => o.value).filter(Boolean);
      if (!models.length) models = [...(AMD_STATIC_MODELS.perplexity)];
    } else if (prov === 'gemini') {
      models = Array.from(document.getElementById('settings-gemini-model')?.options || []).map(o => o.value).filter(Boolean);
      if (!models.length) models = [...(AMD_STATIC_MODELS.gemini)];
    } else {
      // ollama / llama_cpp / lm_studio — live fetch via /api/models/test
      const llm = typeof buildProviderPayload === 'function' ? buildProviderPayload() : {};
      llm.provider = prov;
      const data = await api('/api/models/test', { method: 'POST', body: JSON.stringify({ llm }) });
      models = (data?.models || []).map(m => typeof m === 'string' ? m : (m.name || String(m)));
    }
    if (!models.length) {
      modelSel.innerHTML = '<option value="">— no models found —</option>';
      return;
    }
    modelSel.innerHTML = models.map(m => `<option value="${m}">${typeof window.formatModelDisplayName === 'function' ? window.formatModelDisplayName(m, prov) : m}</option>`).join('');
  } catch (e) {
    modelSel.innerHTML = '<option value="">— fetch failed —</option>';
    console.warn('amdProviderChange error:', e);
  }
}

async function loadAgentModelDefaults() {
  try {
    const data = await api('/api/settings/agent-model-defaults');
    const d = data?.defaults || {};
    for (const [slotId, field] of Object.entries(AMD_SLOTS)) {
      const val = d[field] || '';
      if (!val) continue;
      const parts = val.split('/');
      const prov  = parts[0] || '';
      const model = parts.slice(1).join('/') || '';
      const provSel  = document.getElementById('amd-' + slotId + '-prov');
      const modelSel = document.getElementById('amd-' + slotId + '-model');
      if (provSel) provSel.value = prov;
      if (prov && modelSel) {
        // populate the model dropdown for this provider then set value
        await amdProviderChange(slotId);
        if (modelSel && model) {
          // ensure the saved model exists as an option; add if not
          if (!Array.from(modelSel.options).find(o => o.value === model)) {
            const display = typeof window.formatModelDisplayName === 'function' ? window.formatModelDisplayName(model, prov) : model;
            modelSel.innerHTML += `<option value="${model}">${display}</option>`;
          }
          modelSel.value = model;
        }
      }
    }
  } catch (e) { console.warn('loadAgentModelDefaults error:', e); }
}

async function saveAgentModelDefaults() {
  const payload = {};
  for (const [slotId, field] of Object.entries(AMD_SLOTS)) {
    const prov  = document.getElementById('amd-' + slotId + '-prov')?.value?.trim()  || '';
    const model = document.getElementById('amd-' + slotId + '-model')?.value?.trim() || '';
    if (prov && model) payload[field] = prov + '/' + model;
  }
  const status = document.getElementById('amd-status');
  try {
    await api('/api/settings/agent-model-defaults', { method: 'POST', body: JSON.stringify(payload) });
    if (status) { status.style.color='var(--ok)'; status.textContent='\u2713 Saved'; setTimeout(()=>{status.textContent='';},2500); }
  } catch(e) { if(status){status.style.color='var(--err)';status.textContent='\u2717 '+e.message;} }
}


// ---- Refresh all ----
async function refreshAll() {
  if (typeof renderSessionsList === 'function') renderSessionsList();
  if (typeof updateStats === 'function') updateStats([]);

  if (typeof checkStatus === 'function') checkStatus();
  if (typeof loadSystemStats === 'function') loadSystemStats();

  if (typeof loadSearchSettingsSummary === 'function') loadSearchSettingsSummary();
  if (typeof refreshHeartbeatSummary === 'function') refreshHeartbeatSummary();
  if (typeof renderProgressPanel === 'function') renderProgressPanel();
}

// checkPendingProposalsBadge — EXTRACTED to src/pages/ProposalsPage.js (F3b)


// ---- Sidebar tab switching ----
function setSidebarTab(tab) {
  const panels = { jobs: 'sidebar-jobs', skills: 'sidebar-skills' };
  const tabBtns = { jobs: 'tab-jobs', skills: 'tab-skills' };
  Object.entries(panels).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = key === tab ? '' : 'none';
  });
  Object.entries(tabBtns).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', key === tab);
  });
  if (tab === 'skills' && typeof loadInstalledSkills === 'function') loadInstalledSkills();
  if (tab === 'projects' && typeof renderProjectsList === 'function') renderProjectsList();
}
window.setSidebarTab = setSidebarTab;

// ---- Skills management (v2 - local skills system) ----
let skillsCache = [];
let editingSkillId = null;
let viewingSkillId = null;
let skillModalMode = 'create';
let _skillSearchQuery = '';
let _skillShowCount = 20;
let _pinnedSkills = JSON.parse(localStorage.getItem('prometheus_pinned_skills') || '[]');

function toggleSkillPin(id) {
  const idx = _pinnedSkills.indexOf(id);
  if (idx === -1) _pinnedSkills.push(id);
  else _pinnedSkills.splice(idx, 1);
  localStorage.setItem('prometheus_pinned_skills', JSON.stringify(_pinnedSkills));
  renderSkillsList();
}
window.toggleSkillPin = toggleSkillPin;

function filterSkills(query) {
  _skillSearchQuery = (query || '').toLowerCase().trim();
  _skillShowCount = 20;
  renderSkillsList();
}

function showMoreSkills() {
  _skillShowCount += 20;
  renderSkillsList();
}

const SKILL_FLAME_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c0 0-5 4-5 9a5 5 0 0 0 10 0c0-5-5-9-5-9z"/><path d="M12 12c0 0-2 1.5-2 3a2 2 0 0 0 4 0c0-1.5-2-3-2-3z" fill="currentColor" stroke="none"/></svg>`;
const SKILL_EDIT_ICON  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const SKILL_DEL_ICON   = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
const SKILL_STAR_ICON  = (filled) => filled
  ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
  : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

function skillSearchText(s) {
  return [
    s.id, s.name, s.description,
    ...(Array.isArray(s.categories) ? s.categories : []),
    ...(Array.isArray(s.triggers) ? s.triggers : []),
    ...(Array.isArray(s.requiredTools) ? s.requiredTools : []),
  ].join(' ').toLowerCase();
}

function skillKindLabel(s) {
  return s?.kind === 'bundle' ? 'Bundle' : 'Simple';
}

function skillResourceCount(s) {
  return Array.isArray(s?.resources) ? s.resources.length : 0;
}

function renderSkillBadge(s) {
  if (s?.kind === 'bundle') {
    const count = skillResourceCount(s);
    return `<span class="skill-kind-badge bundle" title="${count} bundled resource${count === 1 ? '' : 's'}">Bundle${count ? ` · ${count}` : ''}</span>`;
  }
  return `<span class="skill-kind-badge simple" title="Single markdown skill">Simple</span>`;
}

function renderSkillMeta(s) {
  const chips = [];
  chips.push(`<span class="skill-modal-chip ${s?.kind === 'bundle' ? 'bundle' : ''}">${skillKindLabel(s)}</span>`);
  if (s?.id) chips.push(`<span class="skill-modal-chip">ID: ${escHtml(s.id)}</span>`);
  if (s?.version) chips.push(`<span class="skill-modal-chip">v${escHtml(s.version)}</span>`);
  const resources = skillResourceCount(s);
  if (resources) chips.push(`<span class="skill-modal-chip">${resources} resource${resources === 1 ? '' : 's'}</span>`);
  const categories = Array.isArray(s?.categories) ? s.categories.filter(Boolean).slice(0, 4) : [];
  categories.forEach((category) => chips.push(`<span class="skill-modal-chip">${escHtml(category)}</span>`));
  const tools = Array.isArray(s?.requiredTools) ? s.requiredTools.filter(Boolean).slice(0, 3) : [];
  tools.forEach((tool) => chips.push(`<span class="skill-modal-chip">Tool: ${escHtml(tool)}</span>`));
  return chips.join('');
}

function openSkillView(id) {
  if (typeof window.openHubSkillModal === 'function') {
    window.openHubSkillModal(id);
  } else {
    openSkillReadOnly(id);
  }
}

function renderSkillHoverActions(id) {
  const safeId = escHtml(id);
  return `
    <div class="skill-hover-popover" onclick="event.stopPropagation()">
      <button type="button" onclick="openSkillView('${safeId}')" title="View skill">View</button>
      <button type="button" onclick="editSkill('${safeId}')" title="Edit skill">Edit</button>
    </div>
  `;
}

function setSkillModalReadOnly(readOnly) {
  ['skill-modal-name', 'skill-modal-emoji', 'skill-modal-desc'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.readOnly = readOnly;
  });
  const instructions = document.getElementById('skill-modal-instructions');
  if (instructions) instructions.readOnly = readOnly;
  const modal = document.getElementById('skill-modal');
  if (modal) modal.classList.toggle('readonly', readOnly);
}

function openSkillModal(mode, skill = null) {
  skillModalMode = mode;
  editingSkillId = mode === 'edit' ? skill?.id || editingSkillId : null;
  viewingSkillId = mode === 'view' ? skill?.id || viewingSkillId : null;
  const readOnly = mode === 'view';
  setSkillModalReadOnly(readOnly);

  document.getElementById('skill-modal-title').textContent = mode === 'create' ? 'Create Skill' : mode === 'edit' ? 'Edit Skill' : (skill?.name || 'Skill');
  document.getElementById('skill-modal-subtitle').textContent = mode === 'view'
    ? 'Read-only skill details.'
    : mode === 'edit'
      ? 'Update the skill playbook.'
      : 'Save a reusable playbook for Prometheus.';
  document.getElementById('skill-modal-save-btn').style.display = readOnly ? 'none' : '';
  document.getElementById('skill-modal-save-btn').textContent = mode === 'edit' ? 'Save Changes' : 'Create Skill';
  document.getElementById('skill-modal-edit-btn').style.display = readOnly ? '' : 'none';
  document.getElementById('skill-modal-cancel-btn').textContent = readOnly ? 'Close' : 'Cancel';

  const meta = document.getElementById('skill-modal-meta');
  if (meta) {
    const hasMeta = skill && mode !== 'create';
    meta.style.display = hasMeta ? 'flex' : 'none';
    meta.innerHTML = hasMeta ? renderSkillMeta(skill) : '';
  }

  document.getElementById('skill-modal-name').value = skill?.name || '';
  document.getElementById('skill-modal-emoji').value = skill?.emoji || '';
  document.getElementById('skill-modal-desc').value = skill?.description || '';
  document.getElementById('skill-modal-instructions').value = skill?.instructions || '';
  document.getElementById('skill-modal').style.display = 'flex';

  const focusId = mode === 'create' || mode === 'edit' ? 'skill-modal-name' : 'skill-modal-instructions';
  const focusEl = document.getElementById(focusId);
  if (focusEl) focusEl.focus();
}

function renderSkillsList() {
  const el = document.getElementById('skills-list');
  if (!el) return;
  let skills = _skillSearchQuery
    ? skillsCache.filter(s => skillSearchText(s).includes(_skillSearchQuery))
    : skillsCache;
  // Pinned skills float to top
  skills = [...skills].sort((a, b) => {
    const ap = _pinnedSkills.includes(a.id) ? 0 : 1;
    const bp = _pinnedSkills.includes(b.id) ? 0 : 1;
    return ap - bp;
  });
  const totalSkills = skills.length;
  const visibleSkills = skills.slice(0, _skillShowCount);
  const hasMoreSkills = totalSkills > visibleSkills.length;
  if (totalSkills === 0) {
    el.innerHTML = _skillSearchQuery
      ? `<div class="empty-state" style="padding:16px">No skills match "${escHtml(_skillSearchQuery)}".</div>`
      : '<div class="empty-state" style="padding:16px">No skills yet.<br>Click "+ Create" to make one!</div>';
  } else {
    el.innerHTML = visibleSkills.map(s => {
      const isPinned = _pinnedSkills.includes(s.id);
      return `
      <div class="skill-card ${isPinned ? ' pinned' : ''}" data-skill-id="${escHtml(s.id)}" onclick="openSkillView('${escHtml(s.id)}')">
        ${renderSkillHoverActions(s.id)}
        <button class="skill-pin-btn${isPinned ? ' active' : ''}" onclick="event.stopPropagation();toggleSkillPin('${escHtml(s.id)}')" title="${isPinned ? 'Unpin' : 'Pin'} skill" aria-label="${isPinned ? 'Unpin' : 'Pin'} skill">${SKILL_STAR_ICON(isPinned)}</button>
        <div class="skill-card-top">
          <div class="skill-card-icon">${SKILL_FLAME_ICON}</div>
          <div class="skill-card-info">
            <div class="skill-card-name-row">
              <div class="skill-card-name">${escHtml(s.name)}</div>
            </div>
            <div class="skill-card-desc">${escHtml(s.description || 'No description')}</div>
          </div>
          <div class="skill-card-actions">
            <button class="skill-remove-btn" onclick="event.stopPropagation();deleteSkill('${escHtml(s.id)}')" title="Delete" aria-label="Delete skill">${SKILL_DEL_ICON}</button>
          </div>
        </div>
      </div>
    `;
    }).join('') + (hasMoreSkills ? `
      <button class="skills-show-more-btn" onclick="showMoreSkills()">
        + Show more (${totalSkills - visibleSkills.length} more)
      </button>
    ` : '');
  }
}

async function loadInstalledSkills() {
  const el = document.getElementById('skills-list');
  if (el) el.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:11px"><span class="spinner"></span> Loading...</div>';
  try {
    const data = await api('/api/skills');
    const skills = data.skills || [];
    skillsCache = skills;
    window.prometheusSkillsCache = skills;
    window.dispatchEvent(new CustomEvent('prometheus:skills-cache-updated', { detail: { skills } }));
    _skillShowCount = 20;
    if (el) renderSkillsList();
  } catch (err) {
    if (el) {
      el.innerHTML = `<div style="padding:12px;color:var(--err);font-size:11px">Error: ${err.message}</div>`;
    } else {
      console.warn('[skills] load failed:', err);
    }
  }
}

async function deleteSkill(id) {
  if (!confirm(`Delete skill "${id}"?`)) return;
  try {
    const res = await api(`/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.success) {
      addProcessEntry('info', `Skill "${id}" deleted.`);
      loadInstalledSkills();
    } else {
      alert(`Delete failed: ${res.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function openCreateSkillModal() {
  openSkillModal('create');
}

async function editSkill(id) {
  try {
    const res = await api(`/api/skills/${encodeURIComponent(id)}`);
    if (!res.success) { alert('Skill not found'); return; }
    openSkillModal('edit', res.skill);
  } catch (err) {
    alert(`Error loading skill: ${err.message}`);
  }
}

async function openSkillReadOnly(id) {
  try {
    const res = await api(`/api/skills/${encodeURIComponent(id)}`);
    if (!res.success) { alert('Skill not found'); return; }
    openSkillModal('view', res.skill);
  } catch (err) {
    alert(`Error loading skill: ${err.message}`);
  }
}

function editSkillFromView() {
  const id = viewingSkillId;
  if (!id) return;
  editSkill(id);
}

function closeSkillModal() {
  document.getElementById('skill-modal').style.display = 'none';
  editingSkillId = null;
  viewingSkillId = null;
  skillModalMode = 'create';
  setSkillModalReadOnly(false);
}

async function saveSkillFromModal() {
  const name = document.getElementById('skill-modal-name').value.trim();
  const rawEmoji = document.getElementById('skill-modal-emoji').value.trim();
  const emoji = (rawEmoji === '🧩' || rawEmoji === '🔥' || rawEmoji === '⚠️') ? rawEmoji : '🧩';
  const description = document.getElementById('skill-modal-desc').value.trim();
  const instructions = document.getElementById('skill-modal-instructions').value.trim();

  if (!name) { alert('Name is required'); return; }
  if (!instructions) { alert('Instructions are required'); return; }

  const btn = document.getElementById('skill-modal-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    let res;
    if (editingSkillId) {
      // Update existing
      res = await api(`/api/skills/${encodeURIComponent(editingSkillId)}`, {
        method: 'PUT',
        body: JSON.stringify({ name, emoji, description, instructions }),
      });
    } else {
      // Create new
      res = await api('/api/skills', {
        method: 'POST',
        body: JSON.stringify({ name, emoji, description, instructions }),
      });
    }
    if (res.success) {
      addProcessEntry('info', `Skill "${name}" ${editingSkillId ? 'updated' : 'created'}!`);
      closeSkillModal();
      loadInstalledSkills();
    } else {
      alert(`Failed: ${res.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = editingSkillId ? 'Save Changes' : 'Create Skill';
  }
}
window.openSkillReadOnly = openSkillReadOnly;
window.openSkillView = openSkillView;
window.editSkillFromView = editSkillFromView;
window.filterSkills = filterSkills;
window.showMoreSkills = showMoreSkills;
window.openCreateSkillModal = openCreateSkillModal;
window.editSkill = editSkill;
window.deleteSkill = deleteSkill;
window.closeSkillModal = closeSkillModal;
window.saveSkillFromModal = saveSkillFromModal;

// ---- Stop Button ----
let currentAbortController = null;
let stopGenerationReconcileTimer = null;

function handleSendStop() {
  if (window.hasPendingPrometheusQuestion?.()) {
    window.stopComposerTranscription?.({ refocus: false });
    Promise.resolve(window.sendChat?.()).catch((err) => console.warn('[question] submit failed:', err));
    return;
  }
  if (window.isDesktopComposerTurnActive?.() || window._sessionThinking?.[window.activeChatSessionId]) {
    stopGeneration();
    return;
  }
  if (document.getElementById('send-btn')?.classList.contains('realtime-voice-stop')) {
    window.toggleVoiceDictation?.();
    return;
  }
  const input = document.getElementById('chat-input');
  if (!(input?.value || '').trim() && !window.hasDesktopComposerOutboundContent?.()) {
    window.toggleVoiceDictation?.();
    return;
  }
  window.stopComposerTranscription?.({ refocus: false });
  (window.sendChat || sendChat)();
}

function finishStoppedGenerationUI(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  delete window._sessionThinking?.[sid];
  delete window._sessionAbortControllers?.[sid];
  // The server's session summary can briefly retain `activeRun` after an
  // abort. It is only a cached presentation marker; once reconciliation says
  // the run is idle it must not keep the composer in its Abort state.
  const session = (window.chatSessions || []).find((item) => String(item?.id || '') === sid);
  if (session) session.activeRun = false;
  if (sid === window.activeChatSessionId) {
    currentAbortController = null;
    window.isThinking = false;
    window.streamingSessionId = null;
    setButtonState(false);
    if (typeof window.syncActiveSessionRunState === 'function') window.syncActiveSessionRunState();
    const input = document.getElementById('chat-input');
    if (input) {
      input.placeholder = 'Send Prometheus a message';
      input.disabled = false;
    }
    if (typeof window.updateQueuedPromptUI === 'function') window.updateQueuedPromptUI();
    if (typeof window.renderChatMessages === 'function') window.renderChatMessages();
    if (typeof window.renderSessionsList === 'function') window.renderSessionsList();
  }
  if (session && typeof window.saveChatSessions === 'function') window.saveChatSessions();
}

function scheduleStoppedGenerationReconcile(sessionId, delayMs = 2500) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  if (stopGenerationReconcileTimer) clearTimeout(stopGenerationReconcileTimer);
  stopGenerationReconcileTimer = setTimeout(async () => {
    stopGenerationReconcileTimer = null;
    const stillMarkedThinking = !!window._sessionThinking?.[sid];
    if (!stillMarkedThinking) {
      finishStoppedGenerationUI(sid);
      return;
    }
    try {
      const res = await fetch(`/api/mobile/chat/runs/${encodeURIComponent(sid)}`, {
        headers: { Accept: 'application/json' },
      });
      const data = res.ok ? await res.json() : null;
      if (data?.active) {
        scheduleStoppedGenerationReconcile(sid, 2500);
        return;
      }
    } catch {
      scheduleStoppedGenerationReconcile(sid, 2500);
      return;
    }
    finishStoppedGenerationUI(sid);
  }, Math.max(0, Number(delayMs) || 0));
}

function stopGeneration() {
  const activeId = window.activeChatSessionId;
  const sessionCtrl = window._sessionAbortControllers?.[activeId];
  const ctrl = sessionCtrl || currentAbortController;
  if (ctrl) {
    ctrl.abort();
  }
  try {
    const abortPromise = typeof window.requestGatewayMainChatAbort === 'function'
      ? window.requestGatewayMainChatAbort(activeId, 'desktop_stop_button')
      : (typeof window.api === 'function'
        ? window.api('/api/mobile/commands/stop-now', {
            method: 'POST',
            body: { sessionId: activeId, source: 'desktop_stop_button' },
            timeoutMs: 15000,
          })
        : null);
    if (abortPromise && typeof abortPromise.catch === 'function') {
      abortPromise
        .then((result) => {
          if (result && result.success === false) scheduleStoppedGenerationReconcile(activeId, 0);
        })
        .catch((err) => console.warn('[chat] Gateway abort request failed:', err));
    }
  } catch (err) {
    console.warn('[chat] Gateway abort request failed:', err);
  }
  // Keep the active thinking bubble mounted until the SSE reader observes the
  // abort and persists the interrupted turn. Anthropic can take longer than
  // OpenAI to close the stream, so eager cleanup makes the bubble/log vanish.
  setButtonState(true);
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.disabled = false;
  const input = document.getElementById('chat-input');
  if (input) {
    input.placeholder = 'Send Prometheus a message';
    input.disabled = false;
    input.focus();
  }
  const thinkingMsg = document.getElementById('thinking-msg');
  if (thinkingMsg) thinkingMsg.classList.add('stopping');
  scheduleStoppedGenerationReconcile(activeId);
}

function setButtonState(thinking) {
  const btn = document.getElementById('send-btn');
  if (!btn) return;
  btn.dataset.thinking = thinking ? 'true' : 'false';
  if (typeof window.updateDesktopComposerSendButton === 'function') {
    window.updateDesktopComposerSendButton();
    return;
  }
  btn.title = thinking ? 'Stop generation' : 'Send';
}

// ── Canvas Panel + File Upload + Context Pinning — EXTRACTED to ChatPage.js (F3f) ──

function getThemeList() {
  return (window.PROM_THEMES && window.PROM_THEMES.length)
    ? window.PROM_THEMES
    : [{ id: 'dark', label: 'Default Dark', base: 'dark' }, { id: 'light', label: 'Light', base: 'light' }];
}

function resolveTheme(id) {
  const list = getThemeList();
  return list.find((t) => t.id === id) || list[0];
}

function nextThemeId(currentId) {
  const list = getThemeList();
  const idx = list.findIndex((t) => t.id === currentId);
  return list[(idx + 1) % list.length].id;
}

function getInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'custom') return saved;
    if (saved && getThemeList().some((t) => t.id === saved)) return saved;
  } catch {}
  return 'light';
}

function applyTheme(themeId) {
  const theme = themeId === 'custom'
    ? { id: 'custom', label: 'Custom theme', base: 'dark' }
    : resolveTheme(themeId);
  document.documentElement.setAttribute('data-theme', theme.base);
  document.documentElement.setAttribute('data-skin', theme.id);
  try {
    const appearance = JSON.parse(localStorage.getItem('prometheus_appearance_v1') || '{}');
    const opacity = Number(appearance.backgroundOpacity);
    document.documentElement.setAttribute('data-background-visuals', appearance.backgroundEffects === true ? 'on' : 'off');
    document.documentElement.style.setProperty('--pm-background-opacity', Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : '0.82');
  } catch {}
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.setAttribute('data-theme-state', theme.base);
    const next = resolveTheme(nextThemeId(theme.id));
    const title = 'Theme: ' + theme.label + ' — click for ' + next.label;
    toggle.title = title;
    toggle.setAttribute('aria-label', title);
  }
  try { localStorage.setItem(THEME_KEY, theme.id); } catch {}
  try {
    document.dispatchEvent(new CustomEvent('prom-theme-change', { detail: { id: theme.id, base: theme.base } }));
  } catch {}
  if (typeof window.renderThemePicker === 'function') window.renderThemePicker();
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-skin')
    || document.documentElement.getAttribute('data-theme')
    || 'dark';
  applyTheme(nextThemeId(current));
}

// ---- Boot ----
// --- SCHEDULER MANAGEMENT — EXTRACTED to src/pages/SchedulePage.js (F3c) ---
// Functions: refreshSchedules, renderScheduleList, _resolveSchedulePattern,
//   onScheduleOccurrenceChange, addScheduleSkill, removeScheduleSkill,
//   _loadScheduleModalData, _resetScheduleModalFields, openScheduleCreateModal,
//   editSchedule, closeScheduleModal, parseSchedulePattern, saveSchedule,
//   deleteSchedule, toggleSchedulePause, runScheduleNow

// Boot sequence — deferred to wait for ES modules to load
window.setupChatMessageScrollbarFade = window.setupChatMessageScrollbarFade || function setupChatMessageScrollbarFadeFallback() {
  const messages = document.getElementById('chat-messages');
  if (!messages || messages.dataset.scrollbarFadeBound === '1') return;
  messages.dataset.scrollbarFadeBound = '1';
  let fadeTimer = null;
  const hideSoon = (delay = 560) => {
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => {
      messages.classList.remove('chat-scroller-active');
      fadeTimer = null;
    }, delay);
  };
  const reveal = () => {
    messages.classList.add('chat-scroller-active');
    hideSoon();
  };
  messages.addEventListener('scroll', reveal, { passive: true });
  messages.addEventListener('wheel', reveal, { passive: true });
  messages.addEventListener('touchmove', reveal, { passive: true });
  messages.addEventListener('pointerdown', reveal);
};

window.addEventListener('DOMContentLoaded', () => {
  if (document.body.classList.contains('pm-mobile-active') && !window.__PROM_CREATIVE_RENDER_CONTEXT?.enabled) return;
  Promise.resolve(window.__PROM_DESKTOP_MODULES_READY || true).catch((err) => {
    console.warn('[boot] desktop module preload failed:', err);
  }).finally(() => {
    // Delay to ensure all <script type="module"> have executed and registered window.* exports
    setTimeout(() => {
    const isRenderWorker = window.__PROM_CREATIVE_RENDER_CONTEXT?.enabled === true;
    if (typeof applyTheme === 'function') applyTheme(getInitialTheme());
    if (!isRenderWorker && typeof setupProcessAndRightScrollTracking === 'function') setupProcessAndRightScrollTracking();
    if (!isRenderWorker && typeof updateHeartbeatUI === 'function') updateHeartbeatUI();
    if (!isRenderWorker) connectWS();
    if (!isRenderWorker && typeof refreshAll === 'function') refreshAll();
    if (!isRenderWorker && typeof updateQueuedPromptUI === 'function') updateQueuedPromptUI();
    if (!isRenderWorker) setInterval(checkStatus, 10000);
    if (!isRenderWorker) setInterval(loadSystemStats, 3000);

    if (!isRenderWorker) {
      const chatModePromise = Promise.resolve(typeof setMode === 'function' ? setMode('chat') : undefined);
      chatModePromise.finally(() => {
        if (typeof window.loadChatSessions === 'function') {
          window.__chatSessionsBootstrapped = true;
          window.loadChatSessions().catch(() => {});
        }
        if (typeof window.loadProjectSidebar === 'function') window.loadProjectSidebar();
      });
    }
    if (!isRenderWorker) window.useAgentMode = true;
    if (typeof canvasInitDrop === 'function') canvasInitDrop();
    if (typeof chatFileUploadInit === 'function') chatFileUploadInit();
    if (typeof setupChatMessageScrollbarFade === 'function') setupChatMessageScrollbarFade();
    }, 200);
  });
});
// --- Integrations Tab ---------------------------------------------------------
// ═══ Integrations (Webhooks + MCP) — EXTRACTED to SettingsPage.js ═══


// ---------------------------------------------------------------------------
// ERROR RESPONSE SYSTEM — Full JavaScript Implementation
// Handles: show/hide panel, option selection, input rendering,
// credential entry, form submission, WS event binding
// ---------------------------------------------------------------------------

// State
let _errTaskId = null;
let _errTemplate = null;
let _errSelectedAction = null;
let _errCategory = null;
let _errBackdrop = null;

// Error Response Panel — EXTRACTED to src/pages/TasksPage.js (F3d)

// -------------------------------------------------------------------------------


// ─── TEAMS PAGE — EXTRACTED to src/pages/TeamsPage.js (F3e) ───────────────
// 67 functions, ~1,954 lines moved to TeamsPage.js

// ═══════════════════════════════════════════════════════════════════

// ═══ CONNECTIONS PANEL — EXTRACTED to src/pages/ConnectionsPage.js ═══
// 18 functions + CONNECTORS const moved

// ── Auto-Update pill ────────────────────────────────────────────────────────
(function() {
  var _dropdownOpen = false;
  var _updaterState = { status: 'idle', supported: false, progress: 0 };
  var _outsideClickHandler = null;

  function updateEls() {
    return {
      pill: document.getElementById('update-pill'),
      label: document.getElementById('update-pill-label'),
      dd: document.getElementById('update-dropdown'),
      kicker: document.getElementById('update-kicker'),
      version: document.getElementById('update-version-text'),
      status: document.getElementById('update-status-text'),
      progressWrap: document.getElementById('update-progress-wrap'),
      progressFill: document.getElementById('update-progress-fill'),
      btn: document.getElementById('update-action-btn'),
      footnote: document.getElementById('update-footnote'),
    };
  }

  function placeUpdateDropdown() {
    var els = updateEls();
    if (!els.pill || !els.dd) return;
    if (els.dd.parentElement !== document.body) {
      document.body.appendChild(els.dd);
    }
    var rect = els.pill.getBoundingClientRect();
    var width = Math.min(280, Math.max(230, window.innerWidth - 24));
    var left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width));
    els.dd.style.width = width + 'px';
    els.dd.style.left = left + 'px';
    els.dd.style.top = Math.min(window.innerHeight - 12, rect.bottom + 10) + 'px';
  }

  function closeUpdateDropdown() {
    var els = updateEls();
    if (els.dd) els.dd.style.display = 'none';
    _dropdownOpen = false;
    if (_outsideClickHandler) {
      document.removeEventListener('click', _outsideClickHandler);
      _outsideClickHandler = null;
    }
  }

  window.toggleUpdateDropdown = function(e) {
    if (e) e.stopPropagation();
    var els = updateEls();
    if (!els.dd) return;
    _dropdownOpen = !_dropdownOpen;
    els.dd.style.display = _dropdownOpen ? 'block' : 'none';
    if (_dropdownOpen) {
      placeUpdateDropdown();
      // close when clicking anywhere outside the pill
      setTimeout(function() {
        _outsideClickHandler = function outsideClick(ev) {
          if (els.pill && !els.pill.contains(ev.target) && els.dd && !els.dd.contains(ev.target)) {
            closeUpdateDropdown();
          }
        };
        document.addEventListener('click', _outsideClickHandler);
      }, 0);
    }
  };

  window.handleUpdateAction = async function(e) {
    if (e) e.stopPropagation();
    if (!window.prometheusUpdater) return;
    var status = String(_updaterState.status || 'idle');
    try {
      if (status === 'ready') {
        const confirmed = await new Promise(function(resolve) {
          if (typeof window.showConfirm !== 'function') { resolve(true); return; }
          window.showConfirm(
            'Prometheus will flush durable writes, create a protected user-state backup, close, install the verified release, reopen, and validate it.',
            function() { resolve(true); },
            function() { resolve(false); },
            { title: 'Install Prometheus update?', confirmText: 'Install & reopen', cancelText: 'Cancel', danger: true }
          );
        });
        if (!confirmed) return;
        await window.prometheusUpdater.installUpdate(true);
        return;
      }
      if (status === 'available' && typeof window.prometheusUpdater.downloadUpdate === 'function') {
        await window.prometheusUpdater.downloadUpdate();
        return;
      }
      if (status === 'checking' || status === 'downloading' || status === 'installing') return;
      await window.prometheusUpdater.checkForUpdates();
    } catch (err) {
      applyUpdateState({
        supported: true,
        status: 'error',
        message: err && err.message ? err.message : 'Update action failed.',
      });
    }
  };

  function shouldShowPill(state) {
    return ['available', 'checking', 'downloading', 'ready', 'error', 'installing'].includes(String(state.status || ''));
  }

  function applyUpdateState(state) {
    _updaterState = Object.assign({}, _updaterState, state || {});
    var els = updateEls();
    if (!els.pill) return;

    var status = String(_updaterState.status || 'idle');
    var version = String(_updaterState.version || '').trim();
    var progress = Math.max(0, Math.min(100, Number(_updaterState.progress || 0)));
    var message = String(_updaterState.message || '').trim();

    els.pill.style.display = shouldShowPill(_updaterState) ? 'flex' : 'none';
    if (els.label) {
      els.label.textContent =
        status === 'checking' ? 'Checking...' :
        status === 'downloading' ? 'Downloading...' :
        status === 'installing' ? 'Installing...' :
        status === 'error' ? 'Update Issue' :
        'Update Available';
    }
    if (els.kicker) els.kicker.textContent = status === 'ready' ? 'NEW RELEASE' : 'PROMETHEUS UPDATE';
    if (els.version) {
      els.version.textContent = version
        ? 'Version ' + version
        : (status === 'idle' ? 'Prometheus is up to date' : 'Checking for updates');
    }
    if (els.status) {
      els.status.textContent = message || (
        status === 'ready' ? 'Downloaded and ready to install.' :
        status === 'available' ? 'A new release is available to download.' :
        status === 'downloading' ? 'Downloading the latest Prometheus release...' :
        status === 'checking' ? 'Checking the release feed now...' :
        status === 'installing' ? 'Prometheus is closing to apply the update...' :
        status === 'error' ? 'Could not complete the update check.' :
        'Prometheus will download the latest release before installing.'
      );
    }
    if (els.progressWrap) els.progressWrap.style.display = status === 'downloading' ? 'block' : 'none';
    if (els.progressFill) els.progressFill.style.width = progress + '%';
    if (els.btn) {
      var busy = status === 'checking' || status === 'downloading' || status === 'installing';
      els.btn.disabled = busy;
      els.btn.style.opacity = busy ? '0.68' : '1';
      els.btn.style.cursor = busy ? 'wait' : 'pointer';
      els.btn.textContent =
        status === 'ready' ? 'Relaunch to Update' :
        status === 'available' ? 'Download Update' :
        status === 'error' ? 'Try Again' :
        status === 'checking' ? 'Checking...' :
        status === 'downloading' ? 'Downloading ' + progress + '%' :
        status === 'installing' ? 'Installing...' :
        'Check for Update';
    }
    if (els.footnote) {
      els.footnote.textContent = status === 'ready'
        ? 'Prometheus will close, install, and reopen'
        : status === 'available' && _updaterState.autoUpdateEnabled === false
          ? 'Automatic updates are off'
        : 'Prometheus will restart after install';
    }
    if (_dropdownOpen) placeUpdateDropdown();
  }

  // Wire up as soon as preload bridge is available.
  // The preload runs before the page, so window.prometheusUpdater exists at DOMContentLoaded.
  if (window.prometheusUpdater) {
    if (typeof window.prometheusUpdater.onState === 'function') {
      window.prometheusUpdater.onState(applyUpdateState);
    }
    if (typeof window.prometheusUpdater.getState === 'function') {
      window.prometheusUpdater.getState().then(applyUpdateState).catch(function() {});
    }
    window.prometheusUpdater.onUpdateReady(function(info) {
      applyUpdateState(Object.assign({ status: 'ready', progress: 100 }, info || {}));
    });
    if (typeof window.prometheusUpdater.onDownloadProgress === 'function') {
      window.prometheusUpdater.onDownloadProgress(function(progress) {
        applyUpdateState({ status: 'downloading', progress: progress });
      });
    }
    if (typeof window.prometheusUpdater.onUpdateError === 'function') {
      window.prometheusUpdater.onUpdateError(function(message) {
        applyUpdateState({ status: 'error', message: message });
      });
    }
  }
  window.addEventListener('resize', function() { if (_dropdownOpen) placeUpdateDropdown(); });
  window.addEventListener('scroll', function() { if (_dropdownOpen) placeUpdateDropdown(); }, true);
})();
