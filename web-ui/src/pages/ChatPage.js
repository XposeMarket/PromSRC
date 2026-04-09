/**
 * ChatPage.js — F3f Extract
 *
 * Chat page: sessions, sendChat (SSE), message rendering, process log,
 * progress panel, agent execution tracking, canvas panel, file upload,
 * context pinning, queued prompts.
 *
 * ~2,421 lines extracted from index.html (the final page extraction).
 *
 * Dependencies: api() from api.js, escHtml/renderMd/showToast/timeAgo/
 *   buildVisualIframe/buildVisualSrcdoc from utils.js
 * Cross-page: setMode from app.js, various page functions via window.*
 */

import { api } from '../api.js';
import { escHtml, renderMd, showToast, timeAgo, buildVisualIframe, buildVisualSrcdoc, bgtToast, showConfirm } from '../utils.js';
import { wsEventBus, wsSend } from '../ws.js';
// (state.js imports handled via window.* proxy above)

// ─── Global state: all shared mutable state accessed via window.* ───────────
// ES modules have their own scope. To share state with the inline <script>,
// connectWS, Settings, and other modules, we access everything via window.
// The inline script declares and exposes all globals on window before modules load.

const API = window.API || '';
const CHAT_SESSIONS_KEY = window.CHAT_SESSIONS_KEY || 'prometheus_chat_sessions_v1';
const AGENT_SESSION_KEY = window.AGENT_SESSION_KEY || 'prometheus_agent_session_id';
const THEME_KEY = window.THEME_KEY || 'prometheus_theme';
const MAX_QUEUED_PROMPTS = window.MAX_QUEUED_PROMPTS || 8;
const AGENT_STATUS = window.AGENT_STATUS || { ACTIVE: 'active', COMPLETED: 'completed', PAUSED: 'paused' };

// Ensure context pin state exists on window
if (window.contextPinMode === undefined) window.contextPinMode = false;
if (window.contextPinnedIndices === undefined) window.contextPinnedIndices = [];

// Terminal sessions state (loaded from server)
if (window.terminalSessions === undefined) window.terminalSessions = [];
window.terminalSessionRefreshTimer = null;


function generateSessionId() {
  return (crypto?.randomUUID?.() || ('sess_' + Math.random().toString(36).slice(2)));
}
function setAgentSessionId(id) {
  const next = String(id || '').trim() || generateSessionId();
  window.agentSessionId = next;
  window.agentSessionId = next;
  localStorage.setItem(AGENT_SESSION_KEY, next);
  return next;
}

function renderQueuedPromptsPanel() {
  const panel = document.getElementById('queued-prompts-panel');
  const list = document.getElementById('queued-prompts-list');
  const title = document.getElementById('queued-prompts-title');
  if (!panel || !list || !title) return;
  const count = window.queuedPrompts.length;
  if (count === 0) {
    panel.style.display = 'none';
    list.innerHTML = '';
    return;
  }
  panel.style.display = 'block';
  title.textContent = `Queued prompts (${count})`;
  list.innerHTML = window.queuedPrompts.map((q, i) => `
    <div class="queued-item">
      <div class="queued-item-text">${escHtml(q)}</div>
      <button class="queued-item-btn" onclick="removeQueuedPrompt(${i})">Remove</button>
    </div>
  `).join('');
}

function removeQueuedPrompt(index) {
  if (!Number.isInteger(index) || index < 0 || index >= window.queuedPrompts.length) return;
  window.queuedPrompts.splice(index, 1);
  updateQueuedPromptUI();
}

function clearQueuedPrompts() {
  if (!window.queuedPrompts.length) return;
  window.queuedPrompts = [];
  addProcessEntry('info', 'Cleared queued prompts.');
  updateQueuedPromptUI();
}

function updateQueuedPromptUI() {
  const badge = document.getElementById('queued-prompts-indicator');
  const sendBtn = document.getElementById('send-btn');
  const input = document.getElementById('chat-input');
  const count = window.queuedPrompts.length;
  if (badge) {
    if (count > 0) {
      badge.style.display = 'inline';
      badge.textContent = `Queued: ${count}`;
    } else {
      badge.style.display = 'none';
      badge.textContent = '';
    }
  }
  if (sendBtn) {
    sendBtn.disabled = false;
    sendBtn.title = window.isThinking ? `Queue next prompt${count ? ` (${count} queued)` : ''}` : 'Send';
  }
  if (input) {
    input.placeholder = window.isThinking
      ? 'Assistant is responding. Press Enter/Send to queue next prompt.'
      : 'Type a message... (Enter to send, Shift+Enter for newline)';
  }
  renderQueuedPromptsPanel();
}

function saveChatSessions() {
  localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(window.chatSessions));
}

function makeSessionTitle(history) {
  const firstUser = (history || []).find(m => m.role === 'user');
  return firstUser ? firstUser.content.slice(0, 42) : 'New chat';
}

// Fetch a single session's full history from the server and populate the stub.
async function _loadSessionFromServer(id) {
  const sess = window.chatSessions.find(s => s.id === id);
  if (!sess || !sess._needsServerLoad) return;
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const data = await res.json();
    const s = data.session;
    if (!s) return;
    sess.history = (s.history || []).map(m => ({
      role: m.role,
      content: m.content || '',
      timestamp: m.timestamp,
    }));
    sess.processLog = s.processLog || [];
    if (sess.history.length > 0) sess.title = makeSessionTitle(sess.history) || sess.title;
    sess.createdAt = s.createdAt || sess.createdAt;
    sess.updatedAt = s.lastActiveAt || sess.updatedAt;
    delete sess._needsServerLoad;
    saveChatSessions();
  } catch {}
}

async function loadChatSessions() {
  try {
    window.chatSessions = JSON.parse(localStorage.getItem(CHAT_SESSIONS_KEY) || '[]');
  } catch {
    window.chatSessions = [];
  }
  if (!Array.isArray(window.chatSessions)) window.chatSessions = [];
  if (window.chatSessions.length === 0) {
    // localStorage is empty — try to recover sessions from disk via server
    let recovered = false;
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) {
        const data = await res.json();
        const serverSessions = Array.isArray(data.sessions) ? data.sessions : [];
        if (serverSessions.length > 0) {
          window.chatSessions = serverSessions.map(s => ({
            id: s.id,
            title: s.title || s.preview || s.id,
            history: [],
            processLog: [],
            createdAt: s.createdAt || Date.now(),
            updatedAt: s.lastActiveAt || s.createdAt || Date.now(),
            // Preserve channel so _isChannelSession works on stubs
            source: (s.channel && s.channel !== 'web') ? s.channel : undefined,
            automated: !!(s.channel && s.channel !== 'web'),
            _needsServerLoad: true,
          }));
          window.activeChatSessionId = window.chatSessions[0].id;
          setAgentSessionId(window.activeChatSessionId);
          saveChatSessions();
          // Eagerly load the active session's history so it renders immediately
          await _loadSessionFromServer(window.activeChatSessionId);
          recovered = true;
        }
      }
    } catch {}

    if (!recovered) {
      const id = crypto?.randomUUID?.() || ('chat_' + Math.random().toString(36).slice(2));
      window.chatSessions.push({ id, title: 'New chat', history: [], processLog: [], createdAt: Date.now(), updatedAt: Date.now() });
      window.activeChatSessionId = id;
      setAgentSessionId(id);
      saveChatSessions();
    }
  } else if (!window.activeChatSessionId || !window.chatSessions.some(s => s.id === window.activeChatSessionId)) {
    window.activeChatSessionId = window.chatSessions[0].id;
    setAgentSessionId(window.activeChatSessionId);
  }
  if (!window.agentSessionId || window.agentSessionId !== window.activeChatSessionId) setAgentSessionId(window.activeChatSessionId);
  syncActiveChat();

  // Load terminal sessions from the server
  loadTerminalSessions();

  // Set up 30-second refresh interval for terminal sessions
  if (window.terminalSessionRefreshTimer) clearInterval(window.terminalSessionRefreshTimer);
  window.terminalSessionRefreshTimer = setInterval(() => {
    loadTerminalSessions();
  }, 30000);
}

function syncActiveChat() {
  const sess = window.chatSessions.find(s => s.id === window.activeChatSessionId);
  window.chatHistory = sess ? (sess.history || []) : [];
  window.processLogEntries = sess ? (sess.processLog || []) : [];
  window.runtimeProgressState = sess && sess.progressState
    ? { source: String(sess.progressState.source || 'none'), activeIndex: Number(sess.progressState.activeIndex || -1), items: Array.isArray(sess.progressState.items) ? sess.progressState.items : [] }
    : { source: 'none', activeIndex: -1, items: [] };
  // Mark session as read when opening it
  if (sess) sess.unread = false;
  renderChatMessages();
  renderProcessLog();
  renderProgressPanel();
  renderSessionsList();
  updateStats([]);
  // Restore canvas tabs for this session (re-fetch content from disk)
  canvasTabs = [];
  activeCanvasTabId = null;
  if (canvasEditor) canvasEditor.setValue('');
  canvasRenderTabs();
  applyCanvasViewMode('code', null);
  const savedPaths = sess && Array.isArray(sess.canvasFiles) ? sess.canvasFiles : [];
  if (savedPaths.length > 0) {
    // Show notify dot so user knows canvas has files for this session
    const dot = document.getElementById('canvas-notify-dot');
    if (dot && !canvasOpen) dot.style.display = 'block';
    // Silently load tabs in background (don't auto-open canvas)
    savedPaths.forEach(f => {
      canvasPresentFile(f.diskPath, f.name).catch(() => {});
    });
  } else {
    const dot = document.getElementById('canvas-notify-dot');
    if (dot) dot.style.display = 'none';
  }
  // Instantly refresh pending actions for the new session
  if (typeof window.loadSessionApprovals === 'function') window.loadSessionApprovals();
}

function persistActiveChat() {
  const idx = window.chatSessions.findIndex(s => s.id === window.activeChatSessionId);
  if (idx === -1) return;
  window.chatSessions[idx].history = window.chatHistory;
  window.chatSessions[idx].processLog = window.processLogEntries;
  window.chatSessions[idx].progressState = window.runtimeProgressState;
  window.chatSessions[idx].title = makeSessionTitle(window.chatHistory);
  window.chatSessions[idx].updatedAt = Date.now();
  // Save canvas files for this session (diskPath + name only, content re-fetched from disk)
  window.chatSessions[idx].canvasFiles = canvasTabs
    .filter(t => t.diskPath)
    .map(t => ({ diskPath: t.diskPath, name: t.name }));
  saveChatSessions();
  renderSessionsList();
  updateStats([]);
}

// Load terminal sessions from the server
async function loadTerminalSessions() {
  try {
    const res = await fetch('/api/sessions?channel=terminal');
    const data = await res.json();
    window.terminalSessions = Array.isArray(data.sessions) ? data.sessions : [];
  } catch {
    window.terminalSessions = [];
  }
  if (typeof window.renderSessionsList === 'function') window.renderSessionsList();
}

// Open a terminal session by loading it from the server and adding to chat sessions
async function openTerminalSession(id) {
  try {
    const res = await fetch(`/api/sessions/${id}`);
    const data = await res.json();
    if (!data.session) return;
    const s = data.session;
    
    // Check if already in chatSessions
    let existing = window.chatSessions.find(c => c.id === id);
    if (!existing) {
      existing = {
        id: s.id,
        title: s.title || s.id,
        history: (s.history || []).map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
          timestamp: m.timestamp,
          channel: 'terminal',
          channelLabel: 'terminal',
        })),
        processLog: [],
        createdAt: s.createdAt,
        updatedAt: s.lastActiveAt,
        automated: false,
        source: 'terminal',
      };
      window.chatSessions.unshift(existing);
      saveChatSessions();
    }
    
    window.activeChatSessionId = id;
    setAgentSessionId(id);
    syncActiveChat();
  } catch (e) {
    addProcessEntry('error', `Could not load terminal session: ${e.message}`);
  }
}

function newChatSession() {
  const id = crypto?.randomUUID?.() || ('chat_' + Math.random().toString(36).slice(2));
  window.chatSessions.unshift({ id, title: 'New chat', history: [], processLog: [], createdAt: Date.now(), updatedAt: Date.now() });
  window.activeChatSessionId = id;
  setAgentSessionId(id);
  syncActiveChat();
  // New regular chat always exits project mode
  if (typeof window._maybeClearProjectState === 'function') {
    window._maybeClearProjectState(id);
  }
}

function toggleSessionsEditMode() {
  window.sessionsEditMode = !window.sessionsEditMode;
  const btn = document.getElementById('sessions-edit-btn');
  if (btn) btn.textContent = window.sessionsEditMode ? 'Done' : 'Edit';
  renderSessionsList();
}

function deleteChatSession(id, ev) {
  if (ev) ev.stopPropagation();
  const idx = window.chatSessions.findIndex(s => s.id === id);
  if (idx === -1) return;

  window.chatSessions.splice(idx, 1);
  if (window.chatSessions.length === 0) {
    const newId = crypto?.randomUUID?.() || ('chat_' + Math.random().toString(36).slice(2));
    window.chatSessions.push({ id: newId, title: 'New chat', history: [], processLog: [], createdAt: Date.now(), updatedAt: Date.now() });
    window.activeChatSessionId = newId;
    setAgentSessionId(newId);
  } else if (window.activeChatSessionId === id) {
    window.activeChatSessionId = window.chatSessions[0].id;
    setAgentSessionId(window.activeChatSessionId);
  }

  saveChatSessions();
  syncActiveChat();
}

async function openSession(id) {
  window.activeChatSessionId = id;
  setAgentSessionId(id);
  const sess = window.chatSessions.find(s => s.id === id);
  if (sess && sess._needsServerLoad) {
    await _loadSessionFromServer(id);
  }
  syncActiveChat();
  // Clear project state if switching to a non-project session
  if (typeof window._maybeClearProjectState === 'function') {
    window._maybeClearProjectState(id);
  }
}

function markSessionUnread(sessionId) {
  const sess = window.chatSessions.find(s => s.id === sessionId);
  if (sess && sessionId !== window.activeChatSessionId) {
    sess.unread = true;
    renderSessionsList();
  }
}

function upsertAutomatedSession(as, opts = {}) {
  if (!as || !as.id) return false;
  const markUnread = opts.markUnread !== false;
  const mappedHistory = Array.isArray(as.history)
    ? as.history.map((m) => ({
        role: m.role === 'ai' ? 'assistant' : (m.role === 'assistant' ? 'assistant' : 'user'),
        content: String(m.content || ''),
        timestamp: Number(m.timestamp) || Date.now(),
        channel: String(m.channel || ''),
        channelLabel: String(m.channelLabel || ''),
      }))
    : [];
  const nextSession = {
    id: as.id,
    title: as.title || 'Automated Session',
    history: mappedHistory,
    processLog: [],
    createdAt: Number(as.createdAt) || Date.now(),
    updatedAt: Date.now(),
    automated: true,
    jobName: as.jobName || '',
    source: String(as.source || ''),
    unread: markUnread,
  };
  const existingIdx = window.chatSessions.findIndex(s => s.id === as.id);
  if (existingIdx === -1) window.chatSessions.push(nextSession);
  else window.chatSessions[existingIdx] = { ...chatSessions[existingIdx], ...nextSession };
  saveChatSessions();
  renderSessionsList();
  if (window.activeChatSessionId === as.id) renderChatMessages();
  return true;
}

// ---- Mode switching ----
function setMode(mode) {
  const validModes = ['chat', 'bgtasks', 'schedule', 'teams', 'proposals', 'audit', 'memory'];
  if (!validModes.includes(mode)) mode = 'chat';
  window.currentMode = mode;

  // Toggle nav buttons
  validModes.forEach((m) => {
    const btn = document.getElementById(`btn-${m}`);
    if (btn) btn.classList.toggle('active', m === mode);
  });
  const moreMenu = document.getElementById('more-menu');
  if (moreMenu) moreMenu.classList.remove('open');
  const moreBtn = document.getElementById('btn-more');
  if (moreBtn) {
    moreBtn.classList.toggle('active', mode === 'audit' || mode === 'memory');
    moreBtn.setAttribute('aria-expanded', 'false');
  }
  const auditItem = document.getElementById('btn-audit');
  if (auditItem) auditItem.classList.toggle('active', mode === 'audit');
  const memoryItem = document.getElementById('btn-memory');
  if (memoryItem) memoryItem.classList.toggle('active', mode === 'memory');

  // Toggle view panels
  const viewMap = {
    chat: 'chat-view',
    bgtasks: 'bgtasks-view',
    schedule: 'schedule-view',
    teams: 'teams-view',
    proposals: 'proposals-view',
    audit: 'audit-view',
    memory: 'memory-view',
  };
  Object.entries(viewMap).forEach(([m, viewId]) => {
    const el = document.getElementById(viewId);
    if (el) el.style.display = m === mode ? 'flex' : 'none';
  });

  // Sidebar/main/right panel should only be visible in chat mode
  const aside = document.querySelector('aside');
  const mainEl = document.querySelector('main');
  const rightPanel = document.getElementById('right-panel');
  if (aside) aside.style.display = mode === 'chat' ? '' : 'none';
  if (mainEl) mainEl.style.display = mode === 'chat' ? '' : 'none';
  if (rightPanel) rightPanel.style.display = mode === 'chat' ? '' : 'none';

  // Load data for selected page
  if (mode === 'bgtasks' && typeof window.refreshBgTasks === 'function') window.refreshBgTasks();
  if (mode === 'schedule' && typeof window.refreshSchedules === 'function') window.refreshSchedules();
  if (mode === 'teams') {
    const badge = document.getElementById('teams-badge');
    if (badge) badge.style.display = 'none';
    if (typeof window.teamsPageActivate === 'function') window.teamsPageActivate();
    else if (typeof window.refreshTeams === 'function') window.refreshTeams();
  }
  if (mode === 'proposals') {
    if (typeof window.loadProposals === 'function') window.loadProposals();
    const badge = document.getElementById('proposals-badge');
    if (badge) badge.style.display = 'none';
  }
  if (mode === 'audit' && typeof window.loadAuditLog === 'function') window.loadAuditLog();
  if (mode === 'memory' && typeof window.memoryPageActivate === 'function') window.memoryPageActivate();
}

// ---- Proposals — EXTRACTED to src/pages/ProposalsPage.js (F3b) ----
// Functions: loadProposals, renderProposals, updateProposalBadge,
//            jumpToProposalSession, approveProposal, denyProposal

// ---- Sidebar tabs ----
function setSidebarTab(tab) {
  window.sidebarTab = tab;
  document.getElementById('tab-jobs').classList.toggle('active', tab === 'jobs');
  document.getElementById('tab-skills').classList.toggle('active', tab === 'skills');
  document.getElementById('sidebar-jobs').style.display = tab === 'jobs' ? 'flex' : 'none';
  document.getElementById('sidebar-skills').style.display = tab === 'skills' ? 'flex' : 'none';
  if (tab === 'skills') loadInstalledSkills();
}

// ---- Agent mode toggle ----
function updateAgentMode() {
  window.useAgentMode = document.getElementById('agent-mode-toggle').checked;
  document.getElementById('agent-mode-label').textContent = window.useAgentMode ? 'Agent' : 'Chat';
  document.getElementById('agent-mode-badge').classList.toggle('visible', window.useAgentMode);
  document.getElementById('chat-input').placeholder = window.useAgentMode
    ? 'Ask agent to do something... (has access to tools)'
    : 'Type a message... (Enter to send, Shift+Enter for newline)';
}

// ---- Chat ----
function renderThinkBlock(thinking) {
  if (!thinking || !thinking.trim()) return '';
  const id = 'think_' + Math.random().toString(36).slice(2);
  const wordCount = thinking.trim().split(/\s+/).length;
  return `
    <div class="think-block">
      <button class="think-toggle" id="${id}_btn" onclick="toggleThink('${id}')">
        <span class="think-icon">...</span>
        <span>Thought process</span>
        <span style="margin-left:auto;opacity:0.5">${wordCount} words</span>
      </button>
      <div class="think-content" id="${id}_body">${escHtml(thinking)}</div>
    </div>
  `;
}

function toggleThink(id) {
  const btn = document.getElementById(id + '_btn');
  const body = document.getElementById(id + '_body');
  if (!btn || !body) return;
  const open = body.style.display !== 'none' && body.style.display !== '';
  body.style.display = open ? 'none' : 'block';
  btn.classList.toggle('open', !open);
}

function renderReactSteps(steps) {
  if (!steps || steps.length === 0) return '';
  const toolSteps = steps.filter(s => s.action);
  if (toolSteps.length === 0) return '';

  const getSearchDiagnostics = (s) => s?.toolData?.search_diagnostics || s?.diagnostics || null;
  const extractUrls = (s, resultText) => {
    const fromToolData = Array.isArray(s?.toolData?.results)
      ? s.toolData.results.map(r => String(r?.url || '').trim()).filter(u => /^https?:\/\//i.test(u))
      : [];
    const fromText = String(resultText || '').match(/https?:\/\/[^\s)]+/g) || [];
    const merged = [...fromToolData, ...fromText.map(u => String(u).trim())];
    const out = [];
    const seen = new Set();
    for (const u of merged) {
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push(u);
      if (out.length >= 5) break;
    }
    return out;
  };
  const providerSummary = (diag) => {
    if (!diag || !Array.isArray(diag.attempted) || !diag.attempted.length) return '';
    return diag.attempted.map(a => {
      const p = String(a.provider || '').toLowerCase();
      const status = String(a.status || '').toLowerCase();
      if (status === 'success') {
        const count = Number.isFinite(a.result_count) ? `, ${a.result_count} result${a.result_count === 1 ? '' : 's'}` : '';
        return `${p}=success${count}`;
      }
      if (status === 'skipped') return `${p}=skipped${a.reason ? ` (${a.reason})` : ''}`;
      return `${p}=failed${a.reason ? ` (${a.reason})` : ''}`;
    }).join(' | ');
  };

  const id = 'steps_' + Math.random().toString(36).slice(2);
  const items = toolSteps.map(s => {
    const resultText = typeof s.toolResult === 'string' ? s.toolResult : JSON.stringify(s.toolResult || '');
    const diag = String(s.action || '') === 'web_search' ? getSearchDiagnostics(s) : null;
    const query = String(diag?.query || s?.params?.query || '').trim();
    const selectedProvider = String(diag?.selected_provider || s?.toolData?.provider || '').toLowerCase();
    const providers = diag ? providerSummary(diag) : '';
    const urls = String(s.action || '') === 'web_search' ? extractUrls(s, resultText) : [];
    return `
      <div class="react-step">
        ${s.thought ? `<div class="react-step-thought">${escHtml(s.thought.slice(0, 120))}</div>` : ''}
        <div class="react-step-action">${escHtml(s.action)}</div>
        ${resultText ? `<div class="react-step-result${resultText.startsWith('ERROR') ? ' error' : ''}">${escHtml(resultText.slice(0, 160))}${resultText.length > 160 ? '…' : ''}</div>` : ''}
        ${diag ? `
          <div style="margin-top:6px;font-size:10px;color:var(--muted);line-height:1.5">
            ${query ? `<div><b>query</b>: ${escHtml(query)}</div>` : ''}
            ${selectedProvider ? `<div><b>provider hit</b>: ${escHtml(selectedProvider)}</div>` : ''}
            ${providers ? `<div><b>providers</b>: ${escHtml(providers)}</div>` : ''}
          </div>
        ` : ''}
        ${String(s.action || '') === 'web_search' && !diag ? `
          <div style="margin-top:6px;font-size:10px;color:var(--muted);line-height:1.5">
            ${selectedProvider ? `<div><b>provider hit</b>: ${escHtml(selectedProvider)}</div>` : ''}
          </div>
        ` : ''}
        ${urls.length ? `
          <div style="margin-top:6px;font-size:10px;line-height:1.6">
            <div style="color:var(--muted);margin-bottom:2px"><b>sources</b>:</div>
            ${urls.slice(0, 3).map((u, i) => `<div>${i + 1}. <a href="${escHtml(u)}" target="_blank" rel="noopener noreferrer">${escHtml(u)}</a></div>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  return `
    <div class="react-steps-toggle" onclick="toggleSteps('${id}')">
      ? ${toolSteps.length} tool step${toolSteps.length !== 1 ? 's' : ''} used
    </div>
    <div class="react-steps" id="${id}" style="display:none">${items}</div>
  `;
}

function toggleSteps(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const visible = el.style.display !== 'none';
  el.style.display = visible ? 'none' : 'block';
  el.previousElementSibling.textContent = `${visible ? '?' : '?'} ${el.querySelectorAll('.react-step').length} tool step${el.querySelectorAll('.react-step').length !== 1 ? 's' : ''} used`;
}

function renderAssistantContent(content) {
  const text = String(content || '');
  const bgHeaderMatch = text.match(/\nBackground agent response:\s*\n?/i) || text.match(/^Background agent response:\s*\n?/i);
  if (bgHeaderMatch && typeof bgHeaderMatch.index === 'number') {
    const splitAt = bgHeaderMatch.index;
    const head = text.slice(0, splitAt).trim();
    const bgBody = text.slice(splitAt + bgHeaderMatch[0].length).trim();
    return `
      <div class="msg-staged">
        ${head ? `<div class="msg-content markdown-body">${renderMd(head)}</div>` : ''}
        <div class="msg-stage">
          <div class="msg-stage-title">Background agent response</div>
          <div class="msg-content markdown-body">${renderMd(bgBody || 'No background details provided.')}</div>
        </div>
      </div>
    `;
  }
  const hasStaged = /(^|\n)(Initial chat|Execution result|Final chat):\s*/i.test(text);
  if (!hasStaged) return `<div class="msg-content markdown-body">${renderMd(text)}</div>`;
  const chunks = text
    .split(/\n\s*---\s*\n/g)
    .map(s => String(s || '').trim())
    .filter(Boolean);
  const html = chunks.map((chunk, idx) => {
    const m = chunk.match(/^(Initial chat|Execution result|Final chat):\s*\n?/i);
    const title = m ? m[1] : `Section ${idx + 1}`;
    const body = m ? chunk.slice(m[0].length).trim() : chunk;
    return `
      <div class="msg-stage">
        <div class="msg-stage-title">${escHtml(title)}</div>
        <div class="msg-content markdown-body">${renderMd(body)}</div>
      </div>
    `;
  }).join('');
  return `<div class="msg-staged">${html}</div>`;
}

// File extension → icon SVG path data and color
function getFileIcon(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  const icons = {
    html: { color:'#e34c26', label:'HTML', path:'M9.4 16.6l-4.3-4.3 4.3-4.3-1.4-1.4L2.6 12.3l5.4 5.4zm5.2 0l4.3-4.3-4.3-4.3 1.4-1.4 5.4 5.4-5.4 5.4z' },
    htm:  { color:'#e34c26', label:'HTM',  path:'M9.4 16.6l-4.3-4.3 4.3-4.3-1.4-1.4L2.6 12.3l5.4 5.4zm5.2 0l4.3-4.3-4.3-4.3 1.4-1.4 5.4 5.4-5.4 5.4z' },
    css:  { color:'#264de4', label:'CSS',  path:'M9.4 16.6l-4.3-4.3 4.3-4.3-1.4-1.4L2.6 12.3l5.4 5.4zm5.2 0l4.3-4.3-4.3-4.3 1.4-1.4 5.4 5.4-5.4 5.4z' },
    js:   { color:'#f7df1e', label:'JS',   path:'M3 3h18v18H3zm4.73 15.04c.4.85 1.19 1.55 2.54 1.55 1.48 0 2.4-.74 2.4-1.99 0-1.25-.84-1.76-2.07-2.26l-.75-.32c-.62-.28-.88-.56-.88-1.08 0-.44.34-.77.88-.77.52 0 .86.23 1.17.77l1.27-.82C11.96 11.59 11.19 11 10.06 11c-1.34 0-2.19.85-2.19 1.97 0 1.21.75 1.74 1.86 2.19l.75.32c.67.28 1.1.57 1.1 1.18 0 .51-.44.88-1.13.88-.82 0-1.31-.44-1.67-1.1z' },
    ts:   { color:'#3178c6', label:'TS',   path:'M3 3h18v18H3zm10.71 14.86c.5.98 1.51 1.73 3.09 1.73 1.6 0 2.8-.83 2.8-2.36 0-1.41-.81-2.08-2.25-2.67l-.42-.18c-.73-.31-1.04-.61-1.04-1.2 0-.48.36-.85 1-.85.61 0 .97.32 1.27.9l1.37-.88c-.59-1.08-1.43-1.5-2.64-1.5-1.67 0-2.74.99-2.74 2.29 0 1.38.81 2.08 2.03 2.59l.42.18c.78.34 1.24.64 1.24 1.29s-.45.99-1.28.99c-.89 0-1.42-.47-1.81-1.15z' },
    py:   { color:'#3776ab', label:'PY',   path:'M9.585 11.692h4.83s2.432.039 2.432-2.35V5.391S17.219 3 12.915 3c-3.053 0-2.861.32-2.861.32s-.481.021-.481 2.492v1.282h4.287v.427H7.629S5 7.846 5 10.96c0 3.114 2.247 3.047 2.247 3.047h1.338v-1.368s-.069-2.947 2.247-2.947zm-.462-6.52c-.353 0-.638-.292-.638-.653 0-.36.285-.653.638-.653.352 0 .637.293.637.653 0 .361-.285.653-.637.653z' },
    json: { color:'#5f6f85', label:'JSON', path:'M5 3h2v2H5v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5h2v2H5c-1.07-.27-2-.9-2-2v-4a2 2 0 0 0-2-2H0v-2h1a2 2 0 0 0 2-2V5a2 2 0 0 1 2-2m14 0c1.07.27 2 .9 2 2v4a2 2 0 0 0 2 2h1v2h-1a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2v-2h2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5h-2V3h2z' },
    md:   { color:'#083fa1', label:'MD',   path:'M22.27 19.385H1.73C.775 19.385 0 18.61 0 17.655V6.345c0-.955.775-1.73 1.73-1.73h20.54c.955 0 1.73.775 1.73 1.73v11.31c0 .955-.775 1.73-1.73 1.73zM5.769 15.923v-4.077l2.308 2.885 2.307-2.885v4.077h2.308V8.077h-2.308l-2.307 2.885-2.308-2.885H3.46v7.846zm14.538 0l-3.462-3.923h2.308V8.077h-2.308v3.923L13.384 8.077v7.846z' },
    sh:   { color:'#4eaa25', label:'SH',   path:'M3 3h18v18H3zm3.35 4.5l-1.4 1.4L9.25 13.3 5 17.5l1.4 1.4 5.65-5.6z' },
  };
  return icons[ext] || { color:'#5f6f85', label: ext.toUpperCase().slice(0,4) || 'FILE', path:'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z' };
}

function renderFilePills(canvasFiles) {
  if (!Array.isArray(canvasFiles) || !canvasFiles.length) return '';
  const pills = canvasFiles.map(filePath => {
    const path = String(filePath || '');
    const name = path.split('/').pop().split('\\').pop() || path;
    const ext = name.split('.').pop().toLowerCase();
    const icon = getFileIcon(name);
    const safeP = escHtml(path).replace(/'/g, '&#39;');
    const safeN = escHtml(name).replace(/'/g, '&#39;');
    return `
      <div class="file-pill">
        <div class="file-pill-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="${escHtml(icon.color)}">
            <path d="${escHtml(icon.path)}"/>
          </svg>
        </div>
        <div class="file-pill-info">
          <div class="file-pill-name">${escHtml(name)}</div>
          <div class="file-pill-meta">${escHtml(ext.toUpperCase())} file &middot; workspace</div>
        </div>
        <div class="file-pill-actions">
          <button class="file-pill-btn" title="Open in Canvas" onclick="canvasPresentFile('${safeP}','${safeN}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 9l-4 3 4 3"/><path d="M16 9l4 3-4 3"/><path d="M12 6v12"/></svg>
          </button>
          <button class="file-pill-btn" title="Download" onclick="canvasDownloadFile('${safeP}','${safeN}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');
  return `<div class="file-pills">${pills}</div>`;
}

function canvasDownloadFile(diskPath, filename) {
  // Fetch from workspace API and trigger browser download
  fetch(`/api/canvas/file?path=${encodeURIComponent(diskPath)}`)
    .then(r => r.json())
    .then(d => {
      if (!d.success) { addProcessEntry('error', `Download failed: ${d.error}`); return; }
      const blob = new Blob([d.content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename || diskPath.split('/').pop() || 'file';
      a.click();
      URL.revokeObjectURL(url);
    })
    .catch(e => addProcessEntry('error', `Download error: ${e.message}`));
}

function renderArtifacts(artifacts) {
  const rows = Array.isArray(artifacts) ? artifacts : [];
  if (!rows.length) return '';
  const cards = rows.map((a, idx) => {
    const type = String(a?.type || '').trim();
    const title = String(a?.title || type || `Artifact ${idx + 1}`).trim();
    const status = String(a?.status || 'ok').toLowerCase();
    const pathVal = String(a?.path || '').trim();
    const fromPath = String(a?.from_path || '').trim();
    const toPath = String(a?.to_path || '').trim();
    const summary = String(a?.summary || '').trim();
    const preview = String(a?.preview || '').trim();
    const files = Array.isArray(a?.files) ? a.files.slice(0, 12).map(x => String(x || '')).filter(Boolean) : [];
    const dirs = Array.isArray(a?.directories) ? a.directories.slice(0, 8).map(x => String(x || '')).filter(Boolean) : [];
    const locationTarget = toPath || pathVal || fromPath;
    return `
      <div class="artifact-card">
        <div class="artifact-head">
          <div class="artifact-title">${escHtml(title)}</div>
          <div class="artifact-status ${escHtml(status)}">${escHtml(status)}</div>
        </div>
        ${pathVal ? `<div class="artifact-row"><b>Path:</b> <code>${escHtml(pathVal)}</code></div>` : ''}
        ${fromPath ? `<div class="artifact-row"><b>From:</b> <code>${escHtml(fromPath)}</code></div>` : ''}
        ${toPath ? `<div class="artifact-row"><b>To:</b> <code>${escHtml(toPath)}</code></div>` : ''}
        ${summary ? `<div class="artifact-row">${escHtml(summary)}</div>` : ''}
        ${files.length ? `<div class="artifact-row"><b>Files:</b> ${escHtml(files.join(', '))}${Array.isArray(a?.files) && a.files.length > files.length ? ' ...' : ''}</div>` : ''}
        ${dirs.length ? `<div class="artifact-row"><b>Directories:</b> ${escHtml(dirs.join(', '))}${Array.isArray(a?.directories) && a.directories.length > dirs.length ? ' ...' : ''}</div>` : ''}
        ${preview ? `<div class="artifact-preview">${escHtml(preview)}</div>` : ''}
        ${locationTarget ? `
          <div class="artifact-actions">
            <button class="artifact-btn" onclick="openInFileLocation('${escHtml(locationTarget).replace(/'/g, '&#39;')}')">Open In File Location</button>
            <button class="canvas-open-btn" onclick="canvasPresentFile('${escHtml(pathVal || locationTarget).replace(/'/g, '&#39;')}', '${escHtml(String(a?.title || pathVal || locationTarget).split('/').pop() || '').replace(/'/g, '&#39;')}')">&#9654; Open in Canvas</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
  return `<div class="artifact-list">${cards}</div>`;
}

async function openInFileLocation(targetPath) {
  const p = String(targetPath || '').trim();
  if (!p) return;
  try {
    const res = await fetch('/api/open-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      throw new Error(String(data?.error || `HTTP ${res.status}`));
    }
    addProcessEntry('info', `Opened in file location: ${p}`);
  } catch (err) {
    addProcessEntry('error', `Open path failed: ${String(err?.message || err)}`);
  }
}

function renderUserMessageContent(msg) {
  let text = msg.content || '';
  const previews = msg.attachmentPreviews;
  // Strip [UPLOADED FILES] block from display — images shown as thumbnails instead
  if (previews && previews.length) {
    text = text.replace(/\n\n\[UPLOADED FILES\][\s\S]*$/, '').trim();
  }
  // Always strip [UPLOADED FILES] block — even for old history entries without previews
  text = text.replace(/\n\n\[UPLOADED FILES\][\s\S]*$/, '').trim();
  const imgHtml = previews && previews.length
    ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:5px">${previews.map((p, i) => `<img src="${p.dataUrl}" class="msg-img-thumb" title="${escHtml(p.name)}" onclick="openImgPreview(this.src,'${escHtml(p.name).replace(/'/g, '&#39;')}')">`).join('')}</div>`
    : '';
  return `${imgHtml}${text ? `<div class="msg-content">${escHtml(text)}</div>` : ''}`;
}

function renderChatMessages() {
  updateTokenCount();
  const container = document.getElementById('chat-messages');

  if (window.chatHistory.length === 0) {
    container.innerHTML = `
      <div class="chat-welcome" id="chat-welcome">
        <div class="chat-welcome-icon"><img src="/assets/Prometheus.png" style="width:90px;height:90px;object-fit:contain;opacity:0.90;"></div>
        <h2>Prometheus</h2>
        <p>"I whom you see am Prometheus, who gave fire to mankind."</p>
        <div class="hint">c. 440–430 BCE, from Prometheus Bound.</div>
      </div>`;
    return;
  }

  container.innerHTML = window.chatHistory.map((msg, idx) => {
    const pinClass = contextPinMode ? ' pin-selectable' : '';
    const selectedClass = (contextPinMode && pinnedMessageIndices.has(idx)) ? ' pin-selected' : '';
    // Also show green for confirmed pins even outside pin mode
    const confirmedClass = (!contextPinMode && confirmedPins.some(p => p.content === msg.content && p.role === (msg.role === 'user' ? 'user' : 'assistant'))) ? ' pin-selected' : '';
    const clickHandler = contextPinMode ? ` onclick="togglePinMessage(${idx})"` : '';
    const isTelegramMsg = String(msg?.channel || '').toLowerCase() === 'telegram';
    const channelTag = isTelegramMsg ? '<span class="msg-channel-tag">(telegram)</span>' : '';
    return `
    <div class="msg ${msg.role}${pinClass}${selectedClass}${confirmedClass}"${clickHandler}>
      <div class="msg-avatar">${msg.role === 'user' ? 'U' : '<img src="/assets/Prometheus.png" style="width:20px;height:20px;object-fit:contain;">'}</div>
      <div class="msg-body">
        <div class="msg-role">${msg.role === 'user' ? 'You' : 'Prom'}${channelTag}</div>
        ${(msg.role === 'ai' || msg.role === 'assistant') ? renderAssistantContent(msg.content) : renderUserMessageContent(msg)}
        ${(msg.role === 'ai' || msg.role === 'assistant') ? renderFilePills(msg.canvasFiles) : ''}
        ${(msg.role === 'ai' || msg.role === 'assistant') ? renderArtifacts(msg.artifacts) : ''}
        ${(msg.role === 'ai' || msg.role === 'assistant') && msg.processEntries && msg.processEntries.length ? renderProcessPill(msg.processEntries) : ''}
        ${(msg.role === 'ai' || msg.role === 'assistant') ? renderThinkBlock(msg.thinking) : ''}
        ${(msg.role === 'ai' || msg.role === 'assistant') ? renderReactSteps(msg.steps) : ''}
      </div>
    </div>`;
  }).join('');

  if (window.isThinking && window.streamingSessionId === window.activeChatSessionId) {
    const progressHtml = window.currentProgressLines.length
      ? `<div style="margin:6px 0 8px 0;font-size:11px;line-height:1.6;color:var(--muted)">
          ${window.currentProgressLines.map((l) => `<div>• ${escHtml(l)}</div>`).join('')}
        </div>`
      : '';
    container.innerHTML += `
      <div class="msg ai" id="thinking-msg">
        <div class="msg-avatar"><img src="/assets/Prometheus.png" style="width:20px;height:20px;object-fit:contain;"></div>
        <div class="msg-body">
          <div class="msg-role">Prom${window.useAgentMode ? ' (Agent)' : ''}${window.activeModelBadge ? ` <span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:600;background:#f0f4ff;color:#3366cc;border:1px solid #c5d3f0">⚡ ${escHtml(window.activeModelBadge.label)}</span>` : ''}</div>
          ${window.currentPreflightStatus ? `<div class="msg-content" style="margin-bottom:6px;color:#26487e">${escHtml(window.currentPreflightStatus)}</div>` : ''}
          ${progressHtml}
          ${window.streamingAIText
            ? `<div id="streaming-text-content" style="font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word">${escHtml(window.streamingAIText)}</div>`
            : `<div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>`
          }
          <div style="margin-top:8px">
            <button class="skill-install-btn" style="font-size:10px;padding:3px 9px" onclick="toggleCurrentProcess()">Process</button>
            <div id="current-turn-process" style="display:none;margin-top:8px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2);padding:8px;max-height:220px;overflow:auto;font-size:11px;line-height:1.6"></div>
          </div>
        </div>
      </div>`;
  }

  container.scrollTop = container.scrollHeight;
}

function pushProgressLine(line) {
  const txt = String(line || '').trim();
  if (!txt) return;
  const last = window.currentProgressLines[window.currentProgressLines.length - 1] || '';
  if (last === txt) return;
  window.currentProgressLines.push(txt);
  if (window.currentProgressLines.length > 8) window.currentProgressLines = window.currentProgressLines.slice(-8);
  if (window.isThinking) renderChatMessages();
}

// ---- Process log ----
function renderProcessPill(entries) {
  const id = 'proc_' + Math.random().toString(36).slice(2);
  return `
    <div style="margin-top:8px">
      <button class="skill-install-btn" style="font-size:10px;padding:3px 9px" onclick="togglePL('${id}')">Process</button>
      <div id="${id}" style="display:none;margin-top:8px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2);padding:8px;max-height:220px;overflow:auto;font-size:11px;line-height:1.6">
        ${formatProcessLines(entries)}
      </div>
    </div>
  `;
}

function normalizeProcessActor(rawActor, type, content, extra) {
  const explicit = String(rawActor || extra?.actor || '').trim();
  if (explicit) {
    if (/background\s*agent/i.test(explicit)) return 'Background Agent';
    if (/background\s*task/i.test(explicit)) return 'Background Task';
    if (/prom/i.test(explicit)) return 'Prom';
  }
  const lower = `${String(type || '').toLowerCase()} ${String(content || '').toLowerCase()}`;
  if (/background_(spawn|status|progress|join)|background agent|\bbg_[a-z0-9-]+/.test(lower)) return 'Background Agent';
  if (/background task|\btask_[a-z0-9-]+/.test(lower)) return 'Background Task';
  return 'Prom';
}

function formatProcessLines(entries) {
  if (!entries || entries.length === 0) return '<div style="color:var(--muted)">No process details.</div>';
  const TYPE_COLORS = {
    user: 'var(--text)', think: '#388bfd', tool: '#e3b341',
    result: '#bc8cff', error: 'var(--red)', final: '#56d364',
    warn: 'var(--yellow)', step: '#56d364', info: '#79c0ff',
    split: 'var(--accent2)', synth: 'var(--accent2)',
  };
  return entries.map(e => {
    const rawType = String(e.type || 'info');
    const actorLabel = normalizeProcessActor(e.actor, rawType, e.content, e.extra);
    const typeLabel = escHtml(rawType).toUpperCase();
    const typeColor = TYPE_COLORS[rawType] || 'var(--muted)';
    const content = escHtml(String(e.content || ''));
    return `<div style="margin-bottom:4px"><span style="color:var(--muted)">[${escHtml(String(e.ts || ''))}]</span> <span style="color:#8b949e;font-weight:600">[${escHtml(actorLabel)}]</span> <span style="color:${typeColor};font-weight:600">${typeLabel}</span> ${content}</div>`;
  }).join('');
}

function toggleCurrentProcess() {
  const panel = document.getElementById('current-turn-process');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  if (!open) {
    const turnEntries = window.currentTurnStartIndex >= 0 ? window.processLogEntries.slice(window.currentTurnStartIndex) : [];
    panel.innerHTML = formatProcessLines(turnEntries);
  }
}

function isNearBottom(el, threshold = 40) {
  if (!el) return true;
  return (el.scrollHeight - (el.scrollTop + el.clientHeight)) <= threshold;
}

function setupProcessAndRightScrollTracking() {
  const processEl = document.getElementById('process-log');
  if (processEl && !processEl.dataset.scrollBound) {
    processEl.dataset.scrollBound = '1';
    processEl.addEventListener('scroll', () => {
      window.processLogAutoFollow = isNearBottom(processEl, 36);
    });
  }

  const rightEl = document.getElementById('right-panel');
  if (rightEl && !rightEl.dataset.scrollBound) {
    rightEl.dataset.scrollBound = '1';
    rightEl.addEventListener('scroll', () => {
      window.rightColumnAutoFollow = isNearBottom(rightEl, 28);
    });
  }
}

function maybeAutoScrollRightColumn(force = false) {
  const rightEl = document.getElementById('right-panel');
  if (!rightEl) return;
  if (force || window.rightColumnAutoFollow || window.isThinking) {
    rightEl.scrollTop = rightEl.scrollHeight;
  }
}

function updateHeartbeatUI() {
  // Heartbeat indicators are logged in Process Log; progress card now handles plan state.
}

function toggleProgressPanel() {
  const card = document.getElementById('progress-card');
  if (!card) return;
  card.classList.toggle('collapsed');
}

function normalizeProgressStatus(rawStatus) {
  const status = String(rawStatus || 'pending');
  if (status === 'done' || status === 'failed' || status === 'in_progress' || status === 'skipped') return status;
  return 'pending';
}

function renderChecklistItemsHTML(items, options = {}) {
  const maxText = Number(options.maxText || 120);
  const safeItems = Array.isArray(items) ? items : [];
  return safeItems.map((item, idx) => {
    const statusRaw = normalizeProgressStatus(item?.status);
    const status = statusRaw === 'skipped' ? 'done' : statusRaw;
    const rawText = String(item?.text || '').trim() || `Step ${idx + 1}`;
    const safeText = escHtml(rawText.slice(0, maxText));
    const number = idx + 1;
    let dotInner = `<span>${number}</span>`;
    if (status === 'done') dotInner = '<span>&#10003;</span>';
    if (status === 'failed') dotInner = '<span>&times;</span>';
    if (status === 'in_progress') dotInner = `<span>${number}</span><span class="progress-spinner"></span>`;
    return `
      <div class="progress-item ${status}">
        <div class="progress-step-dot">${dotInner}</div>
        <div class="progress-step-text">${safeText}</div>
      </div>
    `;
  }).join('');
}

function getTaskProgressItems(task) {
  const runtimeItems = Array.isArray(task?.runtimeProgress?.items) ? task.runtimeProgress.items : [];
  if (runtimeItems.length > 0) {
    return runtimeItems.map((item, idx) => ({
      id: String(item?.id || `runtime_${idx + 1}`),
      text: String(item?.text || `Step ${idx + 1}`),
      status: normalizeProgressStatus(item?.status),
    }));
  }

  const plan = Array.isArray(task?.plan) ? task.plan : [];
  const currentIndex = Number.isFinite(Number(task?.currentStepIndex)) ? Number(task.currentStepIndex) : -1;
  const taskStatus = String(task?.status || '').toLowerCase();
  return plan.map((step, idx) => {
    const raw = String(step?.status || 'pending').toLowerCase();
    let status = 'pending';
    if (raw === 'done' || raw === 'skipped') status = 'done';
    else if (raw === 'failed') status = 'failed';
    else if (taskStatus === 'running' && idx === currentIndex) status = 'in_progress';
    else if (raw === 'running' && (taskStatus === 'running' || taskStatus === 'queued')) status = 'in_progress';
    else if ((taskStatus === 'failed' || taskStatus === 'stalled' || taskStatus === 'needs_assistance') && idx === currentIndex) status = 'failed';
    const suffix = raw === 'skipped' ? ' (skipped)' : '';
    return {
      id: `task_${String(task?.id || 'x')}_${idx + 1}`,
      text: `${String(step?.description || `Step ${idx + 1}`)}${suffix}`,
      status,
    };
  });
}

function renderProgressPanel() {
  const list = document.getElementById('progress-list');
  const empty = document.getElementById('progress-empty');
  if (!list || !empty) return;
  const items = Array.isArray(window.runtimeProgressState?.items) ? window.runtimeProgressState.items : [];

  if (!items.length) {
    empty.style.display = 'block';
    list.style.display = 'none';
    list.innerHTML = '';
    return;
  }

  empty.style.display = 'none';
  list.style.display = 'flex';

  // ── Diff-patch: update existing DOM nodes in-place so CSS transitions survive ──
  // Only rebuild from scratch when the item count changes.
  const existingItems = list.querySelectorAll('.progress-item');

  if (existingItems.length !== items.length) {
    // Count mismatch — full rebuild (new plan declared or step appended)
    list.innerHTML = renderChecklistItemsHTML(items, { maxText: 120 });
    return;
  }

  // Same count: patch each item in-place
  items.forEach((item, idx) => {
    const el = existingItems[idx];
    if (!el) return;

    const statusRaw = normalizeProgressStatus(item?.status);
    const status = statusRaw === 'skipped' ? 'done' : statusRaw;
    const prevStatus = el.dataset.status || '';

    // Only touch the DOM if something changed
    if (prevStatus === status) return;

    // Update class
    el.className = `progress-item ${status}`;
    el.dataset.status = status;

    // Update dot
    const dot = el.querySelector('.progress-step-dot');
    if (dot) {
      const number = idx + 1;
      if (status === 'done') {
        dot.innerHTML = '<span>&#10003;</span>';
      } else if (status === 'failed') {
        dot.innerHTML = '<span>&times;</span>';
      } else if (status === 'in_progress') {
        dot.innerHTML = `<span>${number}</span><span class="progress-spinner"></span>`;
      } else {
        dot.innerHTML = `<span>${number}</span>`;
      }
    }

    // Update text color via class (already handled by class change above),
    // but also re-apply strikethrough for done
    const textEl = el.querySelector('.progress-step-text');
    if (textEl && status === 'done' && prevStatus !== 'done') {
      // Flash a brief highlight before strikethrough settles
      textEl.style.transition = 'color 0.3s ease, text-decoration 0.3s ease';
    }
  });
}

function clearProcessLog() {
  window.processLogEntries.length = 0;
  const el = document.getElementById('process-log');
  if (el) el.innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px 0;opacity:0.5">Waiting for activity...</div>';
  window.processLogAutoFollow = true;
  window.rightColumnAutoFollow = true;
  maybeAutoScrollRightColumn(true);
  persistActiveChat();
}

function addProcessEntry(type, content, extra) {
  const ts = new Date().toLocaleTimeString();
  const actor = (extra && typeof extra === 'object' && extra.actor) ? String(extra.actor) : undefined;
  window.processLogEntries.push({ ts, type, content, extra, actor });
  renderProcessLog();
  maybeAutoScrollRightColumn(window.isThinking || window.rightColumnAutoFollow);
  persistActiveChat();
  if (window.isThinking) {
    const panel = document.getElementById('current-turn-process');
    if (panel && panel.style.display !== 'none' && window.currentTurnStartIndex >= 0) {
      panel.innerHTML = formatProcessLines(window.processLogEntries.slice(window.currentTurnStartIndex));
    }
  }
}

function renderProcessLog() {
  const el = document.getElementById('process-log');
  if (!el) return;
  setupProcessAndRightScrollTracking();
  const shouldFollow = window.processLogAutoFollow || window.isThinking;

  if (window.processLogEntries.length === 0) {
    el.innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px 0;opacity:0.5">Waiting for activity...</div>';
    if (shouldFollow) el.scrollTop = el.scrollHeight;
    return;
  }

  el.innerHTML = window.processLogEntries.map((e,i) => {
    const actorLabel = normalizeProcessActor(e.actor, e.type, e.content, e.extra);
    const actorChip = `<span style="color:#8b949e;font-weight:600">[${escHtml(actorLabel)}]</span>`;
    let icon, color, label, labelColor;
    switch(e.type) {
      case 'user':    icon='&#x1f464;'; color='var(--accent2)'; labelColor='var(--text)';     label='USER';   break;
      case 'think':   icon='&#x1f9e0;'; color='#388bfd';        labelColor='#388bfd';         label='THINK';  break;
      case 'tool':    icon='&#x1f528;'; color='#e3b341';        labelColor='#e3b341';         label='TOOL';   break;
      case 'result':  icon='&#x2713;';  color='#bc8cff';        labelColor='#bc8cff';         label='OK';     break;
      case 'error':   icon='&#x2717;';  color='var(--red)';     labelColor='var(--red)';      label='FAIL';   break;
      case 'final':   icon='&#x2713;';  color='#56d364';        labelColor='#56d364';         label='FINAL';  break;
      case 'warn':    icon='&#x26a0;';  color='var(--yellow)';  labelColor='var(--yellow)';   label='WARN';   break;
      case 'step':    icon='&#x25b8;';  color='#56d364';        labelColor='#56d364';         label='STEP';   break;
      case 'split':   icon='&#x2922;';  color='var(--accent2)'; labelColor='var(--accent2)';  label='SPLIT';  break;
      case 'synth':   icon='&#x2605;';  color='var(--accent2)'; labelColor='var(--accent2)';  label='SYNTH';  break;
      case 'skill':   icon='&#x1f9e9;'; color='#31b884';        labelColor='#31b884';         label='SKILL';  break;
      case 'info':    icon='&#xb7;';    color='#79c0ff';        labelColor='#79c0ff';         label='INFO';   break;
      default:        icon='&#xb7;';    color='var(--muted)';   labelColor='var(--muted)';    label=e.type;   break;
    }

    // Think entries: show full content in a scrollable block
    if (e.type === 'think' && e.content && e.content.length > 60) {
      const id = 'pl_' + Math.random().toString(36).slice(2,8);
      const preview = e.content.slice(0, 80).replace(/\n/g,' ');
      return `
        <div style="margin-bottom:4px">
          <span style="color:var(--muted);font-size:10px">${e.ts}</span>
          <span style="color:${color};margin:0 6px">${icon} ${actorChip} <span style="color:${labelColor}">${label}</span></span>
          <span style="color:var(--muted);cursor:pointer;text-decoration:underline;font-size:10px" onclick="togglePL('${id}')">${escHtml(preview)}…</span>
        </div>
        <div id="${id}" style="display:none;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:8px;margin-bottom:6px;white-space:pre-wrap;color:var(--muted);font-size:10px;max-height:200px;overflow-y:auto;font-style:italic">${escHtml(e.content)}</div>
      `;
    }

    // Tool result entries: collapsible if long
    if (e.type === 'result' && e.content && e.content.length > 120) {
      const id = 'pl_' + Math.random().toString(36).slice(2,8);
      const preview = e.content.slice(0, 100).replace(/\n/g,' ');
      return `
        <div style="margin-bottom:4px">
          <span style="color:var(--muted);font-size:10px">${e.ts}</span>
          <span style="color:${color};margin:0 6px">${icon} ${actorChip} <span style="color:${labelColor}">${label}</span></span>
          <span style="color:${color};cursor:pointer;font-size:10px" onclick="togglePL('${id}')">${escHtml(preview)}… <span style="opacity:0.5">[expand]</span></span>
        </div>
        <div id="${id}" style="display:none;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:8px;margin-bottom:6px;white-space:pre-wrap;color:var(--text);font-size:10px;max-height:300px;overflow-y:auto">${escHtml(e.content)}</div>
      `;
    }

    // Memory suggestion: show approve/reject buttons
    if (e.type === 'memory') {
      const id = 'pl_mem_' + i;
      const suggest = e.extra || {};
      return `
        <div style="margin-bottom:6px">
          <span style="color:var(--muted);font-size:10px">${e.ts}</span>
          <span style="color:${color};margin:0 6px">${icon} ${actorChip} <span style="color:${labelColor}">${label}</span></span>
          <span style="color:var(--text);">${escHtml(String(e.content || ''))}</span>
          <div style="margin-top:6px">
            <button class="btn btn-sm" onclick="confirmMemory(${i})">Approve</button>
            <button class="btn btn-sm" style="margin-left:6px" onclick="rejectMemory(${i})">Reject</button>
          </div>
        </div>
      `;
    }

    // If an 'extra' object/array was provided, show a details toggle
    if (e.extra) {
      const id = 'pl_extra_' + i;
      const pretty = escHtml(JSON.stringify(e.extra, null, 2));
      return `
        <div style="margin-bottom:3px">
          <span style="color:var(--muted);font-size:10px">${e.ts}</span>
          <span style="color:${color}">${icon} ${actorChip} <span style="color:${labelColor}">${label}</span></span>
          <span style="color:var(--text);margin-left:8px">${escHtml(String(e.content || ''))}</span>
          <span style="color:var(--muted);cursor:pointer;margin-left:8px;font-size:10px" onclick="togglePL('${id}')">[details]</span>
        </div>
        <pre id="${id}" style="display:none;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:8px;margin-bottom:6px;color:var(--muted);font-size:11px;max-height:300px;overflow:auto">${pretty}</pre>
      `;
    }

    return `<div style="margin-bottom:3px"><span style="color:var(--muted);font-size:10px">${e.ts}</span> <span style="color:${color}">${icon} ${actorChip} <span style="color:${labelColor}">${label}</span></span>  <span style="color:var(--text)">${escHtml(String(e.content || ''))}</span></div>`;
  }).join('');

  if (shouldFollow) el.scrollTop = el.scrollHeight;
}

function togglePL(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function isFailedTurnReply(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return true;
  if (/^blocked\b/.test(t)) return true;
  if (/^no response received\.?$/.test(t)) return true;
  if (/^connection error:/.test(t)) return true;
  if (/^sorry, i didn'?t catch that/.test(t)) return true;
  if (/could not|couldn't/.test(t) && /(verify|format|synthes|extract|read|write|tool|request)/.test(t)) return true;
  return false;
}

// ---- Send chat (SSE version) ----
async function sendChat(queuedMessage = null) {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  const raw = typeof queuedMessage === 'string' ? queuedMessage : input.value;
  const message = String(raw || '').trim();
  if (!message) return;
  if (window.isThinking) {
    if (typeof queuedMessage === 'string') return;
    if (window.queuedPrompts.length >= MAX_QUEUED_PROMPTS) {
      addProcessEntry('warn', `Queue full (${MAX_QUEUED_PROMPTS}). Wait for current run to finish.`);
      return;
    }
    window.queuedPrompts.push(message);
    addProcessEntry('info', `Queued prompt #${window.queuedPrompts.length}. It will run automatically next.`);
    input.value = '';
    input.style.height = 'auto';
    updateQueuedPromptUI();
    return;
  }

  // Upload any staged files to workspace/canvas before sending
  let fileContextNote = '';
  let uploadedFileCount = 0;
  let visionAttachments = []; // image attachments to send as vision content
  if (pendingChatFiles.length && typeof queuedMessage !== 'string') {
    uploadedFileCount = pendingChatFiles.length;
    const uploadResults = await uploadStagedFilesToCanvas();
    fileContextNote = buildFileContextNote(uploadResults);
    // Collect image attachments for vision injection
    visionAttachments = uploadResults
      .filter(r => r.isImage && r.base64 && r.mimeType)
      .map(r => ({ type: 'image', base64: r.base64, mimeType: r.mimeType, name: r.name }));
    pendingChatFiles = [];
    renderChatFilePills();
  }
  const messageWithFiles = fileContextNote ? message + fileContextNote : message;

  window.chatHistory.push({ role: 'user', content: messageWithFiles, attachmentPreviews: visionAttachments.length ? visionAttachments.map(a => ({ dataUrl: `data:${a.mimeType};base64,${a.base64}`, name: a.name })) : undefined });
  persistActiveChat();
  if (typeof queuedMessage !== 'string') {
    input.value = '';
    input.style.height = 'auto';
  }
  window.isThinking = true;
  window.streamingSessionId = window.activeChatSessionId; // lock bubble to this session
  window.streamingAIText = ''; // reset token stream buffer
  setButtonState(true);
  window.currentPreflightStatus = '';
  window.currentProgressLines = [];
  window.runtimeProgressState = { source: 'none', activeIndex: -1, items: [] };
  window.lastHeartbeat = {
    state: 'running',
    level: '',
    current_step: 'dispatch',
    retry_count: 0,
    format_violation_count: 0,
    message: 'Turn started',
  };
  window.lastHeartbeatLogSignature = '';
  window.processLogAutoFollow = true;
  window.rightColumnAutoFollow = true;
  updateHeartbeatUI();
  renderProgressPanel();
  sendBtn.disabled = false;
  updateQueuedPromptUI();
  renderChatMessages();
  maybeAutoScrollRightColumn(true);

  window.currentTurnStartIndex = window.processLogEntries.length;
  addProcessEntry('user', uploadedFileCount > 0 ? `${message} [+${uploadedFileCount} file(s)]` : message);

  const historyForAPI = window.chatHistory.slice(-13, -1).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content
  }));

  const allSteps = [];
  let finalReply = '';
  let finalArtifacts = [];
  const canvasPresentedFiles = []; // file paths presented to canvas this turn
  const turnThinkingBuffer = [];
  const turnThinkingSeen = new Set();
  let sawExecuteModeThisTurn = false;
  let sawToolActivityThisTurn = false;
  const collectTurnThinking = (value) => {
    const text = String(value || '').trim();
    if (!text) return;
    const key = text.replace(/\s+/g, ' ').trim();
    if (!key || turnThinkingSeen.has(key)) return;
    turnThinkingSeen.add(key);
    turnThinkingBuffer.push(text);
  };

  try {
    // Use SSE fetch — stream steps live as they arrive
    currentAbortController = new AbortController();
    let partialContent = '';

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      signal: currentAbortController.signal,
      body: JSON.stringify({ message: messageWithFiles, history: historyForAPI, useTools: window.useAgentMode, sessionId: window.agentSessionId, pinnedMessages: confirmedPins.length > 0 ? confirmedPins : undefined, attachments: visionAttachments.length > 0 ? visionAttachments : undefined, reasoning: window._activeProvider === 'openai_codex' ? { enabled: true, level: window.reasoningLevel || 'low' } : (window.reasoningEnabled ? { enabled: true, level: window.reasoningLevel || 'low' } : undefined) })
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let event;
        try { event = JSON.parse(line.slice(6)); } catch { continue; }

        switch (event.type) {
          case 'agent_mode':
            window.lastAgentMode = event.mode || '-';
            window.lastTurnKind = event.turnKind || window.lastTurnKind;
            if (event.mode === 'execute') sawExecuteModeThisTurn = true;
            addProcessEntry(
              'info',
              `Agent mode: ${event.mode || 'unknown'}${event.turnKind ? ` (${event.turnKind})` : ''}${event.switched_from ? ` | switched_from=${event.switched_from}` : ''}${event.route_target ? ` | route_target=${event.route_target}` : ''}${event.trigger ? ` | trigger=${event.trigger}` : ''}`
            );
            break;

          case 'session_mode_locked':
            addProcessEntry('info', `Session mode locked: ${event.mode || 'unknown'}`);
            break;

          case 'decomposed':
            addProcessEntry('split', `Split into ${event.questions.length} sub-questions: ${event.questions.map((q,i) => `Q${i+1}: ${q.slice(0,40)}`).join(' | ')}`);
            break;

          case 'token': {
            const chunk = String(event.text || '');
            if (chunk) {
              window.streamingAIText = (window.streamingAIText || '') + chunk;
              // Update the thinking bubble in-place without full re-render
              const streamEl = document.getElementById('streaming-text-content');
              if (streamEl) {
                streamEl.textContent += chunk;
              } else if (window.isThinking) {
                // First token: swap dots → streaming text div
                const thinkingBubble = document.querySelector('#thinking-msg .thinking');
                if (thinkingBubble) {
                  const streamDiv = document.createElement('div');
                  streamDiv.id = 'streaming-text-content';
                  streamDiv.style.cssText = 'font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word';
                  streamDiv.textContent = window.streamingAIText;
                  thinkingBubble.replaceWith(streamDiv);
                }
              }
            }
            break;
          }

          case 'agent_thought': {
            const thoughtText = String(event.text || '').trim();
            if (thoughtText) {
              addProcessEntry('think', thoughtText);
            }
            break;
          }

          case 'thinking':
            if (event.thinking && String(event.thinking).trim()) {
              const thinkingText = String(event.thinking).trim();
              collectTurnThinking(thinkingText);
              addProcessEntry('think', thinkingText);
            }
            break;

          case 'info': {
            if (event.message) {
              const msg = String(event.message);
              // Skill auto-enable/active events get a dedicated SKILL log entry
              const isSkillMsg = /^(Auto-enabled skill|Skill active):/i.test(msg);
              if (isSkillMsg) {
                const skillName = msg.replace(/^(Auto-enabled skill|Skill active):\s*/i, '');
                pushProgressLine(`Skill active: ${skillName}`);
                addProcessEntry('skill', msg, event.actor ? { actor: event.actor } : undefined);
              } else {
                addProcessEntry('info', msg, event.actor ? { actor: event.actor } : undefined);
              }
            }
            break;
          }

          case 'heartbeat': {
            window.lastHeartbeat = {
              ...lastHeartbeat,
              state: event.state || window.lastHeartbeat.state,
              level: event.level || window.lastHeartbeat.level,
              current_step: event.current_step || window.lastHeartbeat.current_step,
              retry_count: Number(event.retry_count || window.lastHeartbeat.retry_count || 0),
              format_violation_count: Number(event.format_violation_count || window.lastHeartbeat.format_violation_count || 0),
              message: event.message || window.lastHeartbeat.message || '',
            };
            updateHeartbeatUI();
            const sig = `${window.lastHeartbeat.state}|${window.lastHeartbeat.level}|${window.lastHeartbeat.current_step}|${window.lastHeartbeat.retry_count}|${window.lastHeartbeat.format_violation_count}`;
            if (sig !== window.lastHeartbeatLogSignature) {
              const level = String(window.lastHeartbeat.level || '').toLowerCase();
              const text = String(window.lastHeartbeat.message || `state=${window.lastHeartbeat.state} step=${window.lastHeartbeat.current_step}`).trim();
              addProcessEntry(level === 'hard' ? 'warn' : 'info', `Heartbeat: ${text}`);
              window.lastHeartbeatLogSignature = sig;
            }
            break;
          }

          case 'ui_preflight':
            if (event.message) {
              window.currentPreflightStatus = String(event.message);
              pushProgressLine(window.currentPreflightStatus);
              renderChatMessages();
            }
            break;

          case 'tool_call': {
            const action = String(event.action || '').trim();
            const stepNum = Number(event.stepNum || 0);
            const planActive = Array.isArray(window.runtimeProgressState?.items)
              && window.runtimeProgressState.items.length >= 2;
            const stepPrefix = planActive && stepNum ? `Step ${stepNum}: ` : '';
            const args = (event.args && typeof event.args === 'object') ? event.args : null;
            const argsPreview = args ? JSON.stringify(args).slice(0, 260) : '';
            const syntheticTag = event.synthetic ? ' [synthetic]' : '';
            sawToolActivityThisTurn = true;
            if (action === 'context_compaction') {
              pushProgressLine('Compacting thread context...');
              addProcessEntry(
                'tool',
                `${stepPrefix}Compacting thread context...${syntheticTag}`,
                (args || event.actor) ? { ...(args || {}), ...(event.actor ? { actor: event.actor } : {}) } : undefined,
              );
              break;
            }
            // Skill tool calls get a dedicated "Searching Skills..." progress line
            const isSkillTool = action === 'skill_list' || action === 'skill_enable' || action === 'skill_create';
            const isBackgroundAgentTool = action.startsWith('background_');
            if (isSkillTool) {
              pushProgressLine('Searching Skills...');
              addProcessEntry('skill', `Searching skills${action === 'skill_create' ? ': creating new skill' : action === 'skill_enable' ? ': reading skill' : ''}...`);
            } else if (isBackgroundAgentTool) {
              pushProgressLine(`Background Agent: ${action}`);
              addProcessEntry(
                'tool',
                `${stepPrefix}${action}${syntheticTag}${argsPreview ? ` ${argsPreview}` : ''}`,
                (args || event.actor) ? { ...(args || {}), actor: event.actor || 'Background Agent' } : { actor: 'Background Agent' },
              );
            } else {
              if (action) pushProgressLine(`${stepPrefix}Running ${action}...`);
              if (action) {
                addProcessEntry(
                  'tool',
                  `${stepPrefix}${action}${syntheticTag}${argsPreview ? ` ${argsPreview}` : ''}`,
                  (args || event.actor) ? { ...(args || {}), ...(event.actor ? { actor: event.actor } : {}) } : undefined,
                );
              }
            }
            break;
          }

          case 'tool_result': {
            const action = String(event.action || '').trim();
            const stepNum = Number(event.stepNum || 0);
            const planActive = Array.isArray(window.runtimeProgressState?.items)
              && window.runtimeProgressState.items.length >= 2;
            const stepPrefix = planActive && stepNum ? `Step ${stepNum}: ` : '';
            sawToolActivityThisTurn = true;
            const text = String(event.result || '');
            const ok = event.error === true ? false : !/^ERROR:/i.test(text);
            const syntheticTag = event.synthetic ? ' [synthetic]' : '';
            const isBackgroundAgentTool = action.startsWith('background_');
            const extraData = (event.extra && typeof event.extra === 'object') ? { ...event.extra } : {};
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
              addProcessEntry(
                ok ? 'result' : 'error',
                `${stepPrefix}${displayResultText}${syntheticTag}`,
                extraPayload,
              );
              break;
            }
            if (action) pushProgressLine(`${stepPrefix}${action} ${ok ? 'complete' : 'failed'}`);
            if (isBackgroundAgentTool) {
              try {
                const parsed = JSON.parse(text);
                const state = String(parsed?.state || '').trim();
                if (state) pushProgressLine(`Background Agent: ${state}`);
              } catch {}
            }
            addProcessEntry(
              ok ? 'result' : 'error',
              `${stepPrefix}${action || 'tool'}${syntheticTag} => ${text || '(no output)'}`,
              extraPayload,
            );
            break;
          }

          case 'tool_progress': {
            const action = String(event.action || '').trim();
            const message = String(event.message || '').trim();
            if (action && message) {
              pushProgressLine(`${action}: ${message}`);
              addProcessEntry('info', `${action}: ${message}`, event.actor ? { actor: event.actor } : undefined);
            }
            break;
          }

          case 'progress_state': {
            window.runtimeProgressState = {
              source: String(event.source || 'none'),
              activeIndex: Number(event.activeIndex || -1),
              items: Array.isArray(event.items) ? event.items.map((item, idx) => ({
                id: String(item.id || `p${idx + 1}`),
                text: String(item.text || '').slice(0, 120),
                status: String(item.status || 'pending'),
              })) : [],
            };
            renderProgressPanel();
            persistActiveChat();
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
              addProcessEntry('think', s.thinking);
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
              // Auto-open canvas and load the file
              canvasPresentFile(presentPath);
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
            const modelLabel = isHaiku ? `⚡ Haiku` : switchedModel.split('/').pop() || switchedModel;
            const badgeText = `${modelLabel}${switchedReason ? ` — ${switchedReason}` : ''}`;
            pushProgressLine(badgeText);
            window.activeModelBadge = { label: modelLabel, reason: switchedReason, provider: switchedProvider };
            renderChatMessages();
            break;
          }

          case 'done':
            finalReply = event.reply || '';
            if (finalReply) partialContent = finalReply;
            finalArtifacts = Array.isArray(event.artifacts) ? event.artifacts : [];
            window.activeModelBadge = null; // clear badge when turn completes
            break;

          case 'turn_execution_created':
          case 'turn_execution_updated':
            break;
        }
      }
    }

    if (finalReply) {
      const finalStep = allSteps.find(s => s.finalAnswer);
      const mergedThinking = turnThinkingBuffer.join('\n\n').trim();
      const shouldAttachThinkingPanel = sawExecuteModeThisTurn || sawToolActivityThisTurn;
      const turnEntries = window.currentTurnStartIndex >= 0 ? window.processLogEntries.slice(window.currentTurnStartIndex) : [];
      window.chatHistory.push({
        role: 'ai',
        content: finalReply,
        artifacts: finalArtifacts,
        canvasFiles: canvasPresentedFiles.length ? [...canvasPresentedFiles] : undefined,
        steps: allSteps,
        mode: window.useAgentMode ? 'agentic' : 'chat',
        thinking: shouldAttachThinkingPanel ? (mergedThinking || finalStep?.thinking) : '',
        processEntries: turnEntries
      });
    } else {
      const turnEntries = window.currentTurnStartIndex >= 0 ? window.processLogEntries.slice(window.currentTurnStartIndex) : [];
      window.chatHistory.push({ role: 'ai', content: 'No response received.', processEntries: turnEntries });
    }
    persistActiveChat();

  } catch (err) {
    const turnEntries = window.currentTurnStartIndex >= 0 ? window.processLogEntries.slice(window.currentTurnStartIndex) : [];
    if (err.name === 'AbortError') {
      addProcessEntry('warn', 'Generation stopped by user.');
      const content = partialContent ||
        (allSteps.length ? `[Stopped — ${allSteps.length} step${allSteps.length !== 1 ? 's' : ''} completed]` : '[Generation stopped]');
      window.chatHistory.push({ role: 'ai', content, steps: allSteps, mode: window.useAgentMode ? 'agentic' : 'chat', processEntries: turnEntries });
    } else {
      window.lastHeartbeat = { ...lastHeartbeat, state: 'stalled', level: 'hard', message: String(err.message || 'connection_error'), current_step: 'error' };
      updateHeartbeatUI();
      addProcessEntry('error', err.message);
      window.chatHistory.push({ role: 'ai', content: `Connection error: ${err.message}`, processEntries: turnEntries });
    }
    persistActiveChat();
  }

  window.isThinking = false;
  window.streamingSessionId = null; // release session lock
  currentAbortController = null;
  setButtonState(false);
  window.currentPreflightStatus = '';
  window.currentProgressLines = [];
  window.lastHeartbeat = { ...lastHeartbeat, state: 'idle', level: '', message: '', current_step: 'done' };
  updateHeartbeatUI();
  window.currentTurnStartIndex = -1;
  sendBtn.disabled = false;
  renderChatMessages();
  updateQueuedPromptUI();

  const shouldPauseQueue = isFailedTurnReply(finalReply || (window.chatHistory[window.chatHistory.length - 1]?.content || ''));
  if (window.queuedPrompts.length > 0 && shouldPauseQueue) {
    addProcessEntry('warn', 'Queue paused because the previous turn failed/blocked. Press Send to resume queued prompts.');
  } else if (window.queuedPrompts.length > 0) {
    const next = window.queuedPrompts.shift();
    updateQueuedPromptUI();
    addProcessEntry('info', `Auto-running queued prompt${window.queuedPrompts.length ? ` (${window.queuedPrompts.length} remaining)` : ''}.`);
    setTimeout(() => { sendChat(next); }, 0);
  }
}

// ---- Agent Execution Tracking ----
function spawnAgentExecution(agentName, taskPrompt, isSubagent = false) {
  const agentId = (isSubagent ? 'sub_' : 'main_') + (++window.agentIdCounter);
  const agentData = {
    id: agentId,
    name: agentName,
    status: AGENT_STATUS.ACTIVE,
    task: taskPrompt,
    logs: [],
    isSubagent: isSubagent,
    startTime: new Date(),
  };
  window.agentExecutionMap.set(agentId, agentData);
  renderAgentExecutionPanel();
  return agentId;
}

function addAgentLog(agentId, type, content) {
  const agentData = window.agentExecutionMap.get(agentId);
  if (!agentData) return;
  const ts = new Date().toLocaleTimeString();
  agentData.logs.push({ ts, type, content });
  // Keep only last 20 logs per agent
  if (agentData.logs.length > 20) agentData.logs.shift();
  renderAgentExecutionPanel();
}

function completeAgentExecution(agentId) {
  const agentData = window.agentExecutionMap.get(agentId);
  if (!agentData) return;
  agentData.status = AGENT_STATUS.COMPLETED;
  renderAgentExecutionPanel();
}

function pauseAgentExecution(agentId, reason) {
  const agentData = window.agentExecutionMap.get(agentId);
  if (!agentData) return;
  agentData.status = AGENT_STATUS.PAUSED;
  if (reason) addAgentLog(agentId, 'error', reason);
  renderAgentExecutionPanel();
}

function renderAgentExecutionPanel() {
  const panel = document.getElementById('agent-execution-panel');
  if (!panel) return;

  if (window.agentExecutionMap.size === 0) {
    panel.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:var(--muted)">Waiting for task execution...</div>';
    return;
  }

  const agents = Array.from(window.agentExecutionMap.values()).sort((a, b) => a.startTime - b.startTime);
  panel.innerHTML = agents.map((agent) => {
    const statusClass = agent.status === AGENT_STATUS.ACTIVE ? 'active' : 
                        agent.status === AGENT_STATUS.COMPLETED ? 'completed' : 'paused';
    const arrow = agent.expanded ? '?' : '?';
    const logsHtml = agent.logs.length > 0
      ? agent.logs.map(log => `<div class="agent-log-entry"><span class="agent-log-entry-time">${escHtml(log.ts)}</span><span class="agent-log-entry-type">[${escHtml(log.type.toUpperCase())}]</span><span class="agent-log-entry-content">${escHtml(log.content)}</span></div>`).join('')
      : '<div style="color:var(--muted);opacity:0.6">No logs yet</div>';

    return `
      <div class="agent-item ${agent.expanded ? 'expanded' : ''}" onclick="toggleAgentPanel('${agent.id}')">
        <div class="agent-item-header">
          <span style="color:var(--muted);font-size:10px;min-width:12px">${arrow}</span>
          <div class="agent-item-name">${escHtml(agent.isSubagent ? '+- ' + agent.name : agent.name)}</div>
          <div class="agent-item-status ${statusClass}">${agent.status.toUpperCase()}</div>
        </div>
        <div class="agent-item-task">${escHtml(agent.task.substring(0, 70))}${agent.task.length > 70 ? '...' : ''}</div>
        <div class="agent-item-logs">${logsHtml}</div>
      </div>
    `;
  }).join('');
}

function toggleAgentPanel(agentId) {
  const agentData = window.agentExecutionMap.get(agentId);
  if (!agentData) return;
  agentData.expanded = !agentData.expanded;
  renderAgentExecutionPanel();
}

function openProcessLogFile() {
  // Call server endpoint to open the process log file
  if (activeTaskId) {
    fetch(`/api/open-file?task=${encodeURIComponent(activeTaskId)}&type=process`)
      .catch(err => console.error('Unable to open process log:', err));
  }
}

function clearChat() {
  window.chatHistory = [];
  persistActiveChat();
  renderChatMessages();
}

// Enter to send, Shift+Enter for newline
document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

// Auto-resize textarea
document.getElementById('chat-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 140) + 'px';
});

// ---- WebSocket ----

// ─── Canvas Panel + File Upload + Context Pinning ──────────────

// ---- Canvas Panel ----
let canvasOpen = false;
let leftPanelCollapsed = false;
let rightPanelCollapsed = false;
let canvasTabs = [];
let activeCanvasTabId = null;
let canvasEditor = null;
let canvasEditorInitialized = false;

const CANVAS_LANG_MAP = {
  js:'javascript', ts:'javascript', jsx:'javascript', tsx:'javascript', mjs:'javascript',
  html:'htmlmixed', htm:'htmlmixed',
  css:'css', py:'python', xml:'xml',
  json:'javascript', md:'markdown', txt:'null',
};

function getCanvasLang(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  return CANVAS_LANG_MAP[ext] || 'null';
}

function isHtmlFile(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  return ext === 'html' || ext === 'htm';
}

function toggleLeftPanel() {
  leftPanelCollapsed = !leftPanelCollapsed;
  document.body.classList.toggle('left-collapsed', leftPanelCollapsed);
  const btn = document.getElementById('sidebar-collapse-btn');
  if (btn) btn.title = leftPanelCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
}

function toggleRightPanel() {
  rightPanelCollapsed = !rightPanelCollapsed;
  document.body.classList.toggle('right-collapsed', rightPanelCollapsed);
  const btn = document.getElementById('right-collapse-btn');
  if (btn) btn.title = rightPanelCollapsed ? 'Expand panel' : 'Collapse panel';
}

function toggleCanvas() {
  canvasOpen = !canvasOpen;
  const panel = document.getElementById('canvas-panel');
  const btn = document.getElementById('canvas-toggle-btn');
  const topbar = document.getElementById('right-panel-topbar');
  const dot = document.getElementById('canvas-notify-dot');
  if (!panel) return;
  if (canvasOpen) {
    panel.style.display = 'flex';
    if (topbar) topbar.style.display = 'none'; // canvas has its own header
    if (btn) { btn.style.background='#eaf2ff'; btn.style.borderColor='#bdd3f6'; btn.style.color='#0d4faf'; }
    if (dot) dot.style.display = 'none'; // clear notification when opened
    if (!canvasEditorInitialized) initCanvasEditor();
    canvasRenderTabs();
  } else {
    panel.style.display = 'none';
    if (topbar) topbar.style.display = 'flex';
    if (btn) { btn.style.background=''; btn.style.borderColor=''; btn.style.color=''; }
  }
}

function initCanvasEditor() {
  canvasEditorInitialized = true;
  const wrap = document.getElementById('canvas-editor-wrap');
  if (!wrap || typeof CodeMirror === 'undefined') return;
  canvasEditor = CodeMirror(wrap, {
    value: '',
    mode: 'htmlmixed',
    lineNumbers: true,
    lineWrapping: true,
    tabSize: 2,
    indentWithTabs: false,
    theme: 'default',
    extraKeys: { 'Ctrl-S': () => canvasSave(), 'Cmd-S': () => canvasSave() },
  });
  canvasEditor.on('change', () => {
    const tab = canvasTabs.find(t => t.id === activeCanvasTabId);
    if (!tab) return;
    const newVal = canvasEditor.getValue();
    if (tab.diskPath && newVal !== tab.savedContent) {
      tab.dirty = true;
    } else if (tab.diskPath) {
      tab.dirty = false;
    }
    tab.content = newVal;
    if (tab.mode === 'preview') canvasUpdatePreview();
    canvasRenderTabs();
  });
}

function canvasNewFile() {
  const name = prompt('File name:', 'untitled.html');
  if (!name || !name.trim()) return;
  const id = 'ctab_' + Math.random().toString(36).slice(2);
  canvasTabs.push({ id, name: name.trim(), content: '', mode: 'code', language: getCanvasLang(name) });
  canvasOpenTab(id);
}

function canvasOpenTab(id) {
  activeCanvasTabId = id;
  const tab = canvasTabs.find(t => t.id === id);
  if (!tab) return;
  // Apply view mode FIRST so the change event fires with the correct mode already set
  applyCanvasViewMode(tab.mode || 'code', tab);
  if (canvasEditor) {
    // Temporarily disconnect change handler to avoid double-render during setValue
    const silentSet = () => {
      canvasEditor.setValue(tab.content || '');
      canvasEditor.setOption('mode', tab.language || 'null');
      setTimeout(() => canvasEditor.refresh(), 10);
    };
    silentSet();
  }
  canvasRenderTabs();
}

function canvasCloseTab(id, ev) {
  if (ev) ev.stopPropagation();
  const idx = canvasTabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  // Tell server this file is no longer on the canvas
  const closingTab = canvasTabs[idx];
  if (closingTab && closingTab.diskPath) canvasNotifyClose(closingTab.diskPath);
  canvasTabs.splice(idx, 1);
  if (activeCanvasTabId === id) {
    if (canvasTabs.length > 0) {
      canvasOpenTab(canvasTabs[Math.min(idx, canvasTabs.length - 1)].id);
    } else {
      activeCanvasTabId = null;
      if (canvasEditor) canvasEditor.setValue('');
      applyCanvasViewMode('code', null);
      canvasRenderTabs();
    }
  } else {
    canvasRenderTabs();
  }
}

function setCanvasMode(mode) {
  const tab = canvasTabs.find(t => t.id === activeCanvasTabId);
  if (!tab) return;
  // sync editor -> tab before switching
  if (canvasEditor && tab.mode !== 'preview') tab.content = canvasEditor.getValue();
  tab.mode = mode;
  applyCanvasViewMode(mode, tab);
  canvasRenderTabs();
}

function applyCanvasViewMode(mode, tab) {
  const editorWrap = document.getElementById('canvas-editor-wrap');
  const previewFrame = document.getElementById('canvas-preview-frame');
  const emptyState = document.getElementById('canvas-empty-state');
  const codeModeBtn = document.getElementById('canvas-code-btn');
  const previewModeBtn = document.getElementById('canvas-preview-btn');
  if (!tab) {
    if (editorWrap) editorWrap.style.display = 'none';
    if (previewFrame) previewFrame.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';
  // Image tabs always show in preview mode — hide code/preview toggle buttons
  if (tab.isImage) {
    if (editorWrap) editorWrap.style.display = 'none';
    if (previewFrame) { previewFrame.style.display = 'flex'; previewFrame.style.flex = '1'; }
    if (codeModeBtn) codeModeBtn.style.display = 'none';
    if (previewModeBtn) previewModeBtn.style.display = 'none';
    canvasUpdatePreview();
    return;
  }
  // Restore buttons for non-image tabs
  if (codeModeBtn) codeModeBtn.style.display = '';
  if (previewModeBtn) previewModeBtn.style.display = '';
  if (mode === 'preview') {
    if (editorWrap) editorWrap.style.display = 'none';
    if (previewFrame) { previewFrame.style.display = 'flex'; previewFrame.style.flex = '1'; }
    if (codeModeBtn) codeModeBtn.classList.remove('active');
    if (previewModeBtn) previewModeBtn.classList.add('active');
    canvasUpdatePreview();
  } else {
    if (editorWrap) { editorWrap.style.display = 'flex'; editorWrap.style.flex = '1'; }
    if (previewFrame) previewFrame.style.display = 'none';
    if (codeModeBtn) codeModeBtn.classList.add('active');
    if (previewModeBtn) previewModeBtn.classList.remove('active');
    if (canvasEditor) setTimeout(() => { canvasEditor.refresh(); canvasEditor.focus(); }, 10);
  }
}

function canvasRenderTabs() {
  const tabsEl = document.getElementById('canvas-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = canvasTabs.map(t => `
    <div class="canvas-tab ${t.id === activeCanvasTabId ? 'active' : ''} ${t.dirty ? 'canvas-tab-dirty' : ''}" onclick="canvasOpenTab('${t.id}')" title="${escHtml(t.diskPath || t.name)}">
      <span>${escHtml(t.name)}</span>
      <button class="canvas-tab-close" onclick="canvasCloseTab('${t.id}', event)" title="Close">×</button>
    </div>
  `).join('') + `<button class="canvas-new-tab" onclick="canvasNewFile()" title="New file">+</button>`;
  const tab = canvasTabs.find(t => t.id === activeCanvasTabId);
  const codeModeBtn = document.getElementById('canvas-code-btn');
  const previewModeBtn = document.getElementById('canvas-preview-btn');
  const saveBtn = document.getElementById('canvas-save-btn');
  if (codeModeBtn) codeModeBtn.classList.toggle('active', !tab || tab.mode !== 'preview');
  if (previewModeBtn) previewModeBtn.classList.toggle('active', !!(tab && tab.mode === 'preview'));
  // Show save button only for non-image files with a disk path
  if (saveBtn) saveBtn.style.display = (tab && tab.diskPath && !tab.isImage) ? 'flex' : 'none';
}

function canvasUpdatePreview() {
  const frame = document.getElementById('canvas-preview-frame');
  const tab = canvasTabs.find(t => t.id === activeCanvasTabId);
  if (!frame || !tab) return;
  const content = tab.content || '';
  const ext = (tab.name || '').split('.').pop().toLowerCase();

  // Image files — render directly as an img tag
  if (tab.isImage) {
    const bg = document.documentElement.getAttribute('data-theme') === 'dark' ? '#1f242d' : '#f4f6fb';
    frame.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: ${bg}; display: flex; align-items: center; justify-content: center;
             min-height: 100vh; padding: 16px; }
      img { max-width: 100%; max-height: 100vh; object-fit: contain;
            border-radius: 6px; box-shadow: 0 4px 24px rgba(0,0,0,0.18); }
      .info { position: fixed; bottom: 10px; right: 12px; font-family: monospace;
              font-size: 10px; color: #888; background: rgba(0,0,0,0.45);
              padding: 3px 8px; border-radius: 4px; }
    </style></head><body>
      <img src="${content}" alt="${tab.name}" onload="document.querySelector('.info').textContent=this.naturalWidth+'×'+this.naturalHeight">
      <div class="info">loading...</div>
    </body></html>`;
    return;
  }

  // Markdown preview
  if (ext === 'md' && typeof marked !== 'undefined') {
    const rendered = marked.parse(content, { breaks: true, gfm: true, mangle: false, headerIds: false });
    frame.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:system-ui,sans-serif;line-height:1.7;padding:24px 32px;max-width:800px;margin:0 auto;color:#17243b}
      h1,h2,h3{font-weight:700;margin:16px 0 8px} code{background:#f0f4fb;padding:2px 6px;border-radius:4px;font-size:0.88em}
      pre{background:#f0f4fb;padding:14px;border-radius:8px;overflow-x:auto} pre code{background:none;padding:0}
      blockquote{border-left:3px solid #3b82f6;padding-left:14px;color:#64748b;margin:10px 0}
      table{border-collapse:collapse;width:100%} th,td{border:1px solid #dbe3ee;padding:6px 10px}
      a{color:#1668e3} hr{border:none;border-top:1px solid #dbe3ee;margin:16px 0}
    </style></head><body>${rendered}</body></html>`;
    return;
  }

  // JSON pretty-print
  if (ext === 'json') {
    try {
      const pretty = JSON.stringify(JSON.parse(content), null, 2);
      frame.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:monospace;font-size:13px;padding:16px;white-space:pre-wrap;word-break:break-word;color:#17243b}</style></head><body>${pretty.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</body></html>`;
    } catch {
      frame.srcdoc = `<pre style="font-family:monospace;padding:16px;white-space:pre-wrap">${content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`;
    }
    return;
  }

  if (!isHtmlFile(tab.name) && !content.trim().startsWith('<')) {
    frame.srcdoc = `<pre style="font-family:monospace;padding:16px;white-space:pre-wrap;word-break:break-word">${content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`;
    return;
  }
  frame.srcdoc = content;
  frame.onload = () => {
    try {
      const doc = frame.contentDocument;
      if (!doc || !doc.body) return;
      doc.body.contentEditable = 'true';
      doc.body.spellcheck = false;
      doc.body.addEventListener('input', () => {
        const html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
        tab.content = html;
        // sync back to editor so Code mode shows updated content
        if (canvasEditor && tab.mode !== 'preview') canvasEditor.setValue(html);
      });
    } catch {}
  };
}

async function canvasSave() {
  const tab = canvasTabs.find(t => t.id === activeCanvasTabId);
  if (!tab) { addProcessEntry('warn', 'Canvas: no file open to save.'); return; }
  if (canvasEditor && tab.mode !== 'preview') tab.content = canvasEditor.getValue();

  // If tab has a workspace disk path, save back to disk
  if (tab.diskPath) {
    const btn = document.getElementById('canvas-save-btn');
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
    try {
      const r = await fetch('/api/canvas/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: tab.diskPath, content: tab.content }),
      });
      const d = await r.json();
      if (d.success) {
        tab.dirty = false;
        tab.savedContent = tab.content;
        canvasRenderTabs();
        addProcessEntry('info', `Canvas: saved → ${tab.diskPath}`);
      } else {
        addProcessEntry('error', `Canvas: save failed — ${d.error}`);
      }
    } catch (e) {
      addProcessEntry('error', `Canvas: save error — ${e.message}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save';
      }
    }
    return;
  }

  // No disk path — fall back to browser download
  const blob = new Blob([tab.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = tab.name; a.click();
  URL.revokeObjectURL(url);
  addProcessEntry('info', `Canvas: downloaded ${tab.name}`);
}

function canvasAddToContext() {
  const tab = canvasTabs.find(t => t.id === activeCanvasTabId);
  if (!tab) { addProcessEntry('warn', 'Canvas: no file open.'); return; }
  if (canvasEditor && tab.mode !== 'preview') tab.content = canvasEditor.getValue();
  const ext = tab.name.split('.').pop() || 'txt';
  const block = '```' + ext + '\n' + tab.content + '\n```';
  // Send as a message to the LLM so it enters context
  const prompt = `Here is the contents of my file "${tab.name}" for reference:\n\n${block}\n\nI've loaded this file into context. What would you like me to do with it?`;
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.value = prompt;
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
  }
  sendChat();
  addProcessEntry('info', `Canvas: sent ${tab.name} to LLM as context.`);
}

// ──────────────────────────────────────────────────────────────────────────
// CHAT FILE UPLOAD
// Staged files live in pendingChatFiles[] until the user hits Send.
// On send they are uploaded to workspace/uploads/ and opened in canvas.
// ──────────────────────────────────────────────────────────────────────────

// Each entry: { file: File, name: string, ext: string, text: string|null }
let pendingChatFiles = [];

const TEXT_EXTENSIONS = new Set([
  'txt','md','csv','json','js','ts','jsx','tsx','html','htm','css','scss','less',
  'py','rb','php','java','c','cpp','h','go','rs','sh','bash','yaml','yml',
  'toml','ini','cfg','conf','xml','svg','sql','graphql','vue','svelte','log'
]);

// Images — read as DataURL, uploaded as binary, sent to AI as vision attachment
const IMAGE_EXTENSIONS = new Set(['png','jpg','jpeg','webp','gif','bmp','ico']);
// Other binary types — uploaded as binary, AI reads by path/shell tools
const BINARY_EXTENSIONS = new Set(['pdf','docx','doc','xls','xlsx','pptx','ppt','zip','rar','7z']);

function getCanvasFileIcon(ext) {
  const e = (ext || '').toLowerCase();
  if (['jpg','jpeg','png','gif','webp','bmp','ico','svg'].includes(e)) return '🖼️';
  if (['mp4','mov','avi','mkv','webm'].includes(e)) return '🎥';
  if (['mp3','wav','ogg','flac','m4a'].includes(e)) return '🎵';
  if (['pdf'].includes(e)) return '📄';
  if (['zip','rar','7z','tar','gz'].includes(e)) return '📦';
  if (['doc','docx'].includes(e)) return '📃';
  if (['xls','xlsx','csv'].includes(e)) return '📈';
  if (['ppt','pptx'].includes(e)) return '📊';
  if (['js','ts','jsx','tsx','py','rb','java','c','cpp','go','rs'].includes(e)) return '💻';
  if (['html','htm','css','scss'].includes(e)) return '🌐';
  if (['json','yaml','yml','toml','xml'].includes(e)) return '⚙️';
  if (['md','txt'].includes(e)) return '📝';
  if (['sh','bash'].includes(e)) return '🖥️';
  return '📎';
}

function renderChatFilePills() {
  const staging = document.getElementById('chat-file-staging');
  if (!staging) return;
  if (!pendingChatFiles.length) {
    staging.style.display = 'none';
    staging.innerHTML = '';
    return;
  }
  staging.style.display = 'flex';
  staging.innerHTML = pendingChatFiles.map((f, idx) => {
    const isImg = IMAGE_EXTENSIONS.has(f.ext);
    const preview = isImg && f.dataUrl
      ? `<img src="${f.dataUrl}" style="width:28px;height:28px;object-fit:cover;border-radius:4px;flex-shrink:0" alt="">`
      : `<span class="pill-icon">${getCanvasFileIcon(f.ext)}</span>`;
    return `<div class="chat-file-pill">
      ${preview}
      <span class="pill-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
      <span class="pill-ext">${escHtml(f.ext || 'file')}</span>
      <button class="pill-remove" onclick="removeChatFile(${idx})" title="Remove">&times;</button>
    </div>`;
  }).join('');
}

function openImgPreview(src, name) {
  if (document.getElementById('img-preview-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'img-preview-overlay';
  overlay.className = 'img-preview-overlay';
  overlay.innerHTML = `
    <div class="img-preview-box" onclick="event.stopPropagation()">
      <button class="img-preview-close" onclick="closeImgPreview()" title="Close">&times;</button>
      <img src="${src}" alt="${name || ''}">
      ${name ? `<div class="img-preview-name">${name}</div>` : ''}
    </div>`;
  overlay.addEventListener('click', closeImgPreview);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', _imgPreviewKeyHandler);
}
function closeImgPreview() {
  const el = document.getElementById('img-preview-overlay');
  if (el) el.remove();
  document.removeEventListener('keydown', _imgPreviewKeyHandler);
}
function _imgPreviewKeyHandler(e) {
  if (e.key === 'Escape') closeImgPreview();
}
window.openImgPreview = openImgPreview;
window.closeImgPreview = closeImgPreview;

function removeChatFile(idx) {
  pendingChatFiles.splice(idx, 1);
  renderChatFilePills();
}

async function stageFiles(fileList) {
  const promises = Array.from(fileList).map(file => new Promise(resolve => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (TEXT_EXTENSIONS.has(ext)) {
      const reader = new FileReader();
      reader.onload = e => resolve({ file, name: file.name, ext, text: e.target.result, dataUrl: null, binary: false });
      reader.onerror = () => resolve({ file, name: file.name, ext, text: null, dataUrl: null, binary: false });
      reader.readAsText(file);
    } else if (IMAGE_EXTENSIONS.has(ext)) {
      // Read as DataURL — enables thumbnail preview and vision attachment
      const reader = new FileReader();
      reader.onload = e => resolve({ file, name: file.name, ext, text: null, dataUrl: e.target.result, binary: false, isImage: true });
      reader.onerror = () => resolve({ file, name: file.name, ext, text: null, dataUrl: null, binary: true, isImage: true });
      reader.readAsDataURL(file);
    } else if (BINARY_EXTENSIONS.has(ext)) {
      // Binary — upload to server as base64, AI reads by path
      const reader = new FileReader();
      reader.onload = e => {
        // Convert ArrayBuffer to base64
        const bytes = new Uint8Array(e.target.result);
        let b64 = '';
        for (let i = 0; i < bytes.byteLength; i++) b64 += String.fromCharCode(bytes[i]);
        resolve({ file, name: file.name, ext, text: null, dataUrl: null, binary: true, base64: btoa(b64) });
      };
      reader.onerror = () => resolve({ file, name: file.name, ext, text: null, dataUrl: null, binary: true });
      reader.readAsArrayBuffer(file);
    } else {
      resolve({ file, name: file.name, ext, text: null, dataUrl: null, binary: true });
    }
  }));
  const staged = await Promise.all(promises);
  pendingChatFiles.push(...staged);
  renderChatFilePills();
}

function onChatFileInputChange(event) {
  const files = event.target.files;
  if (!files || !files.length) return;
  stageFiles(files);
  // Reset input so same file can be re-added after removal
  event.target.value = '';
}

// Upload staged files to workspace/uploads/ and open them in canvas.
// Returns an array of { name, workspacePath, isImage, base64, mimeType } for context injection.
async function uploadStagedFilesToCanvas() {
  if (!pendingChatFiles.length) return [];
  const results = [];
  for (const sf of pendingChatFiles) {
    if (sf.text !== null) {
      // Text file — upload as before
      try {
        const r = await fetch('/api/canvas/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: sf.name, content: sf.text })
        });
        const d = await r.json();
        if (d.success) {
          await canvasPresentFile(d.absPath, d.filename);
          results.push({ name: sf.name, workspacePath: d.absPath, relPath: d.relPath });
        } else {
          results.push({ name: sf.name, workspacePath: null, error: d.error });
        }
      } catch (e) {
        results.push({ name: sf.name, workspacePath: null, error: e.message });
      }
    } else if (sf.isImage && sf.dataUrl) {
      // Image — upload as binary, also attach for vision
      const mimeType = sf.dataUrl.split(';')[0].replace('data:', '') || `image/${sf.ext}`;
      const pureBase64 = sf.dataUrl.replace(/^data:[^;]+;base64,/, '');
      try {
        const r = await fetch('/api/canvas/upload-binary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: sf.name, base64: pureBase64, mimeType })
        });
        const d = await r.json();
        if (d.success) {
          results.push({ name: sf.name, workspacePath: d.absPath, relPath: d.relPath, isImage: true, base64: pureBase64, mimeType });
        } else {
          // Still include vision data even if save failed
          results.push({ name: sf.name, workspacePath: null, isImage: true, base64: pureBase64, mimeType, error: d.error });
        }
      } catch (e) {
        results.push({ name: sf.name, workspacePath: null, isImage: true, base64: pureBase64, mimeType, error: e.message });
      }
    } else if (sf.base64) {
      // Other binary (pdf, docx, xls…) — upload to workspace so AI can access by path
      const mimeType = getMimeType(sf.ext);
      try {
        const r = await fetch('/api/canvas/upload-binary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: sf.name, base64: sf.base64, mimeType })
        });
        const d = await r.json();
        if (d.success) {
          results.push({ name: sf.name, workspacePath: d.absPath, relPath: d.relPath, binary: true });
        } else {
          results.push({ name: sf.name, workspacePath: null, binary: true, error: d.error });
        }
      } catch (e) {
        results.push({ name: sf.name, workspacePath: null, binary: true, error: e.message });
      }
    } else {
      results.push({ name: sf.name, workspacePath: null, binary: true });
    }
  }
  return results;
}

function getMimeType(ext) {
  const map = {
    pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt: 'application/vnd.ms-powerpoint', zip: 'application/zip',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  };
  return map[(ext || '').toLowerCase()] || 'application/octet-stream';
}

// Build the context snippet appended to the user message describing uploaded files.
function buildFileContextNote(uploadResults) {
  if (!uploadResults.length) return '';
  const lines = uploadResults.map(r => {
    if (r.isImage && r.workspacePath) return `  • "${r.name}" (image) → saved to: ${r.workspacePath}`;
    if (r.isImage && !r.workspacePath) return `  • "${r.name}" (image) — attached for vision analysis`;
    if (r.workspacePath) return `  • "${r.name}" → copied to workspace at: ${r.workspacePath}`;
    if (r.binary) return `  • "${r.name}" — binary file (not copied; view your original)`;
    return `  • "${r.name}" — upload failed: ${r.error || 'unknown error'}`;
  });
  const hasImages = uploadResults.some(r => r.isImage && r.base64);
  const imageNote = hasImages ? '\nImages above are attached directly — you can see them.' : '';
  return `\n\n[UPLOADED FILES]\n${lines.join('\n')}${imageNote}\nUse the exact workspace paths above to read, edit, or process files.`;
}

function chatFileUploadInit() {
  const inputArea = document.querySelector('.chat-input-area');
  if (!inputArea) return;

  // Expand drag target to the full chat column (#chat-view covers messages + input)
  const chatView = document.getElementById('chat-view') || inputArea;

  // Drag-over visual feedback on the full chat column
  chatView.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    chatView.classList.add('drag-over');
  });
  chatView.addEventListener('dragleave', (e) => {
    if (!chatView.contains(e.relatedTarget)) chatView.classList.remove('drag-over');
  });
  chatView.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    chatView.classList.remove('drag-over');
    const files = e.dataTransfer?.files;
    if (files && files.length) stageFiles(files);
  });
}

function canvasInitDrop() {
  const panel = document.getElementById('canvas-panel');
  if (!panel) return;
  panel.addEventListener('dragover', (e) => { e.preventDefault(); panel.classList.add('canvas-drag-over'); });
  panel.addEventListener('dragleave', (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('canvas-drag-over'); });
  panel.addEventListener('drop', (e) => {
    e.preventDefault();
    panel.classList.remove('canvas-drag-over');
    Array.from(e.dataTransfer.files).forEach(canvasLoadFile);
  });
}

function canvasLoadFile(file) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const content = ev.target.result;
    const id = 'ctab_' + Math.random().toString(36).slice(2);
    canvasTabs.push({ id, name: file.name, content, mode: 'code', language: getCanvasLang(file.name) });
    if (!canvasOpen) toggleCanvas();
    canvasOpenTab(id);
    addProcessEntry('info', `Canvas: opened ${file.name}`);
  };
  reader.readAsText(file);
}

// Handle files selected via the "Add File" button (OS file picker)
function canvasHandleFileInput(input) {
  const files = Array.from(input.files || []);
  files.forEach(canvasLoadFile);
  // Reset so the same file can be re-selected if needed
  input.value = '';
}

// ---- Canvas Workspace Integration ----

// Present a workspace file in the canvas (called from SSE handler or "Open in Canvas" button).
// Fetches content from the server and opens/updates a tab.
// Notify the server which files are open in the canvas so the AI always
// knows exact paths without guessing.
function canvasNotifyOpen(diskPath) {
  if (!diskPath || !window.agentSessionId) return;
  fetch('/api/canvas/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: window.agentSessionId, path: diskPath }),
  }).catch(() => {});
}
function canvasNotifyClose(diskPath) {
  if (!diskPath || !window.agentSessionId) return;
  fetch('/api/canvas/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: window.agentSessionId, path: diskPath }),
  }).catch(() => {});
}

async function canvasPresentFile(diskPath, label) {
  if (!diskPath) return;
  const name = label || diskPath.split('/').pop() || diskPath;
  // Check if already open — update instead of duplicating
  let tab = canvasTabs.find(t => t.diskPath === diskPath);
  if (tab) {
    // Re-fetch to get latest content
    try {
      const r = await fetch(`/api/canvas/file?path=${encodeURIComponent(diskPath)}`);
      const d = await r.json();
      if (d.success) {
        tab.content = d.content;
        tab.savedContent = d.content;
        tab.dirty = false;
        if (canvasEditor && activeCanvasTabId === tab.id) {
          canvasEditor.setValue(d.content);
          canvasEditor.setOption('mode', getCanvasLang(name));
        }
      }
    } catch {}
    if (!canvasOpen) toggleCanvas();
    canvasOpenTab(tab.id);
    return;
  }
  // New tab — fetch content
  try {
    const r = await fetch(`/api/canvas/file?path=${encodeURIComponent(diskPath)}`);
    const d = await r.json();
    if (!d.success) { addProcessEntry('error', `Canvas: could not load ${diskPath} — ${d.error}`); return; }
    const id = 'ctab_' + Math.random().toString(36).slice(2);
    const ext = name.split('.').pop().toLowerCase();
    if (d.isImage) {
      // Image file — store as data URL, display in preview mode
      const dataUrl = `data:${d.mimeType};base64,${d.base64}`;
      canvasTabs.push({
        id, name, content: dataUrl, savedContent: dataUrl,
        diskPath, dirty: false,
        mode: 'preview',
        language: 'null',
        isImage: true,
        mimeType: d.mimeType,
      });
    } else {
      const autoPreview = ext === 'html' || ext === 'htm' || ext === 'md';
      canvasTabs.push({
        id, name, content: d.content, savedContent: d.content,
        diskPath, dirty: false,
        mode: autoPreview ? 'preview' : 'code',
        language: getCanvasLang(name),
      });
    }
    if (!canvasOpen) toggleCanvas();
    canvasOpenTab(id);
    canvasNotifyOpen(diskPath); // tell server this file is now on the canvas
    addProcessEntry('info', `Canvas: opened ${diskPath}`);
    persistActiveChat(); // save canvas file list to session
  } catch (e) {
    addProcessEntry('error', `Canvas: fetch error — ${e.message}`);
  }
}

// Load workspace file list and show the file browser panel.
async function canvasLoadWorkspaceFiles() {
  const browser = document.getElementById('canvas-file-browser');
  const hint = document.getElementById('canvas-no-files-hint');
  const tree = document.getElementById('canvas-file-tree');
  if (!browser || !tree) return;
  tree.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:11px">Loading…</div>';
  browser.style.display = 'flex';
  if (hint) hint.style.display = 'none';
  try {
    const r = await fetch('/api/canvas/files');
    const d = await r.json();
    if (!d.success) { tree.innerHTML = `<div style="padding:12px;color:var(--err)">${escHtml(d.error)}</div>`; return; }
    tree.innerHTML = canvasRenderFileTree(d.files, 0);
  } catch (e) {
    tree.innerHTML = `<div style="padding:12px;color:var(--err)">${escHtml(e.message)}</div>`;
  }
}

function canvasHideFileBrowser() {
  const browser = document.getElementById('canvas-file-browser');
  const hint = document.getElementById('canvas-no-files-hint');
  if (browser) browser.style.display = 'none';
  if (hint) hint.style.display = 'flex';
}

function canvasRenderFileTree(nodes, depth) {
  if (!Array.isArray(nodes) || !nodes.length) return '';
  const icons = { html:'\uD83D\uDCC4', htm:'\uD83D\uDCC4', md:'\uD83D\uDCDD', ts:'\uD83D\uDCBB', js:'\uD83D\uDCBB', json:'{ }', css:'\uD83C\uDFA8', py:'\uD83D\uDC0D', txt:'\uD83D\uDCCB', sh:'\u25BA' };
  let html = '';
  const sorted = [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of sorted) {
    const pad = depth * 12;
    if (node.type === 'dir') {
      html += `<div class="canvas-file-tree-dir" style="padding-left:${pad + 12}px">📁 ${escHtml(node.name)}</div>`;
      if (node.children && node.children.length) html += canvasRenderFileTree(node.children, depth + 1);
    } else {
      const ext = node.name.split('.').pop().toLowerCase();
      const icon = icons[ext] || '\uD83D\uDCC4';
      html += `<div class="canvas-file-tree-item" style="padding-left:${pad + 12}px" onclick="canvasPresentFile('${escHtml(node.path).replace(/'/g, '\\&apos;')}', '${escHtml(node.name).replace(/'/g, '\\&apos;')}')">${icon} ${escHtml(node.name)}</div>`;
    }
  }
  return html;
}

// ---- Context Pinning ----
const MAX_PINS = 3;
let contextPinMode = false;
let pinnedMessageIndices = new Set();
let confirmedPins = []; // Array of { role, content } sent with each request

function toggleContextPinMode() {
  const pop = document.getElementById('context-pin-popover');
  if (!pop) return;
  const isOpen = pop.classList.contains('open');
  // Close other popovers
  document.getElementById('quick-mode-popover')?.classList.remove('open');
  if (isOpen) {
    cancelContextPin();
  } else {
    contextPinMode = true;
    pop.classList.add('open');
    document.body.classList.add('context-pin-active');
    // Reset selection to currently confirmed pins
    pinnedMessageIndices = new Set();
    for (const pin of confirmedPins) {
      const idx = window.chatHistory.findIndex(m => m.content === pin.content && m.role === pin.role);
      if (idx >= 0) pinnedMessageIndices.add(idx);
    }
    updatePinUI();
    renderChatMessages();
  }
}

function cancelContextPin() {
  contextPinMode = false;
  pinnedMessageIndices = new Set();
  document.getElementById('context-pin-popover')?.classList.remove('open');
  document.body.classList.remove('context-pin-active');
  renderChatMessages();
}

function confirmContextPin() {
  confirmedPins = [];
  for (const idx of pinnedMessageIndices) {
    const msg = window.chatHistory[idx];
    if (msg) confirmedPins.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
  }
  contextPinMode = false;
  document.getElementById('context-pin-popover')?.classList.remove('open');
  document.body.classList.remove('context-pin-active');
  updatePinBadge();
  renderChatMessages();
  if (confirmedPins.length > 0) {
    addProcessEntry('info', `${confirmedPins.length} message(s) pinned to context.`);
  } else {
    addProcessEntry('info', 'Context pins cleared.');
  }
}

function togglePinMessage(index) {
  if (!contextPinMode) return;
  if (pinnedMessageIndices.has(index)) {
    pinnedMessageIndices.delete(index);
  } else if (pinnedMessageIndices.size < MAX_PINS) {
    pinnedMessageIndices.add(index);
  }
  updatePinUI();
  renderChatMessages();
}

function removePinFromList(index) {
  pinnedMessageIndices.delete(index);
  updatePinUI();
  renderChatMessages();
}

function updatePinUI() {
  const countEl = document.getElementById('context-pin-count');
  const listEl = document.getElementById('context-pin-list');
  if (countEl) countEl.textContent = `${pinnedMessageIndices.size}/${MAX_PINS} selected`;
  if (listEl) {
    if (pinnedMessageIndices.size === 0) {
      listEl.innerHTML = '<div style="font-size:11px;color:var(--muted);text-align:center;padding:8px">Click messages in chat to select them</div>';
    } else {
      listEl.innerHTML = Array.from(pinnedMessageIndices).map(idx => {
        const msg = window.chatHistory[idx];
        if (!msg) return '';
        const icon = msg.role === 'user' ? '👤' : '<img src="/assets/Prometheus.png" style="width:20px;height:20px;object-fit:contain;">';
        const text = msg.content.slice(0, 60) + (msg.content.length > 60 ? '...' : '');
        return `<div class="pin-card">
          <span>${icon}</span>
          <div class="pin-card-text">${escHtml(text)}</div>
          <button class="pin-card-remove" onclick="removePinFromList(${idx})">&times;</button>
        </div>`;
      }).join('');
    }
  }
}

function updatePinBadge() {
  const label = document.getElementById('context-pin-label');
  if (label) {
    label.textContent = confirmedPins.length > 0 ? `Context (${confirmedPins.length})` : 'Context';
  }
  const btn = document.getElementById('context-pin-btn');
  if (btn) {
    btn.style.borderColor = confirmedPins.length > 0 ? '#86d4a8' : '';
    btn.style.background = confirmedPins.length > 0 ? '#f0faf4' : '';
    btn.style.color = confirmedPins.length > 0 ? '#0a6b3d' : '';
  }
}


// ─── Expose on window for HTML onclick handlers ────────────────
window.generateSessionId = generateSessionId;
window.setAgentSessionId = setAgentSessionId;
window.renderQueuedPromptsPanel = renderQueuedPromptsPanel;
window.removeQueuedPrompt = removeQueuedPrompt;
window.clearQueuedPrompts = clearQueuedPrompts;
window.updateQueuedPromptUI = updateQueuedPromptUI;
window.saveChatSessions = saveChatSessions;
window.makeSessionTitle = makeSessionTitle;
window.loadChatSessions = loadChatSessions;
window._loadSessionFromServer = _loadSessionFromServer;
window.loadTerminalSessions = loadTerminalSessions;
window.syncActiveChat = syncActiveChat;
window.persistActiveChat = persistActiveChat;
window.newChatSession = newChatSession;
window.openTerminalSession = openTerminalSession;
window.toggleSessionsEditMode = toggleSessionsEditMode;
window.deleteChatSession = deleteChatSession;
window.openSession = openSession;
window.markSessionUnread = markSessionUnread;
window.upsertAutomatedSession = upsertAutomatedSession;
window.setMode = setMode;
window.setSidebarTab = setSidebarTab;
window.updateAgentMode = updateAgentMode;
window.renderThinkBlock = renderThinkBlock;
window.toggleThink = toggleThink;
window.renderReactSteps = renderReactSteps;
window.toggleSteps = toggleSteps;
window.renderAssistantContent = renderAssistantContent;
// window.getFileIcon — first declaration already exposed above
window.renderFilePills = renderFilePills;
window.canvasDownloadFile = canvasDownloadFile;
window.renderArtifacts = renderArtifacts;
window.openInFileLocation = openInFileLocation;
window.renderChatMessages = renderChatMessages;
window.pushProgressLine = pushProgressLine;
window.renderProcessPill = renderProcessPill;
window.formatProcessLines = formatProcessLines;
window.toggleCurrentProcess = toggleCurrentProcess;
window.isNearBottom = isNearBottom;
window.setupProcessAndRightScrollTracking = setupProcessAndRightScrollTracking;
window.maybeAutoScrollRightColumn = maybeAutoScrollRightColumn;
window.updateHeartbeatUI = updateHeartbeatUI;
window.toggleProgressPanel = toggleProgressPanel;
window.normalizeProgressStatus = normalizeProgressStatus;
window.renderChecklistItemsHTML = renderChecklistItemsHTML;
window.getTaskProgressItems = getTaskProgressItems;
window.renderProgressPanel = renderProgressPanel;
window.clearProcessLog = clearProcessLog;
window.addProcessEntry = addProcessEntry;
window.renderProcessLog = renderProcessLog;
window.togglePL = togglePL;
window.isFailedTurnReply = isFailedTurnReply;
window.sendChat = sendChat;
window.spawnAgentExecution = spawnAgentExecution;
window.addAgentLog = addAgentLog;
window.completeAgentExecution = completeAgentExecution;
window.pauseAgentExecution = pauseAgentExecution;
window.renderAgentExecutionPanel = renderAgentExecutionPanel;
window.toggleAgentPanel = toggleAgentPanel;
window.openProcessLogFile = openProcessLogFile;
window.clearChat = clearChat;
window.getCanvasLang = getCanvasLang;
window.isHtmlFile = isHtmlFile;
window.toggleCanvas = toggleCanvas;
window.toggleLeftPanel = toggleLeftPanel;
window.toggleRightPanel = toggleRightPanel;
window.initCanvasEditor = initCanvasEditor;
window.canvasNewFile = canvasNewFile;
window.canvasOpenTab = canvasOpenTab;
window.canvasCloseTab = canvasCloseTab;
window.setCanvasMode = setCanvasMode;
window.applyCanvasViewMode = applyCanvasViewMode;
window.canvasRenderTabs = canvasRenderTabs;
window.canvasUpdatePreview = canvasUpdatePreview;
window.canvasSave = canvasSave;
window.canvasAddToContext = canvasAddToContext;
window.renderChatFilePills = renderChatFilePills;
window.removeChatFile = removeChatFile;
window.stageFiles = stageFiles;
window.onChatFileInputChange = onChatFileInputChange;
window.uploadStagedFilesToCanvas = uploadStagedFilesToCanvas;
window.buildFileContextNote = buildFileContextNote;
window.chatFileUploadInit = chatFileUploadInit;
window.canvasInitDrop = canvasInitDrop;
window.canvasLoadFile = canvasLoadFile;
window.canvasHandleFileInput = canvasHandleFileInput;
window.canvasNotifyOpen = canvasNotifyOpen;
window.canvasNotifyClose = canvasNotifyClose;
window.canvasPresentFile = canvasPresentFile;
window.canvasLoadWorkspaceFiles = canvasLoadWorkspaceFiles;
window.canvasHideFileBrowser = canvasHideFileBrowser;
window.canvasRenderFileTree = canvasRenderFileTree;
window.toggleContextPinMode = toggleContextPinMode;
window.cancelContextPin = cancelContextPin;
window.confirmContextPin = confirmContextPin;
window.togglePinMessage = togglePinMessage;
window.removePinFromList = removePinFromList;
window.updatePinUI = updatePinUI;
window.updatePinBadge = updatePinBadge;

// ─── WS Event Handlers (F5) ────────────────────────────────────

wsEventBus.on('boot_greeting', (msg) => {
  if (msg?.automatedSession && typeof window.upsertAutomatedSession === 'function') {
    window.upsertAutomatedSession(msg.automatedSession, { markUnread: true });
    showToast('Startup update available in a new chat');
    return;
  }
  // Backward-compatible fallback for older payloads without automatedSession.
  if (msg?.sessionId && msg?.text && typeof window.upsertAutomatedSession === 'function') {
    window.upsertAutomatedSession({
      id: msg.sessionId,
      title: msg.title || '🌅 Startup',
      history: [{ role: 'assistant', content: msg.text }],
      createdAt: Date.now(),
      automated: true,
    }, { markUnread: true });
    showToast('Startup update available in a new chat');
    return;
  }

  const bootSess = (window.chatSessions || []).find(s => s.id === window.activeChatSessionId);
  if (bootSess && (!bootSess.history || bootSess.history.length === 0)) {
    bootSess.history = [{ role: 'assistant', content: msg.text }];
    bootSess.updatedAt = Date.now();
    saveChatSessions();
    syncActiveChat();
    renderChatMessages();
  }
});

wsEventBus.on('session_notification', (msg) => {
  if (!msg) return;
  const appendToPreviousSession = () => {
    const prevId = String(msg.previousSessionId || '').trim();
    const text = String(msg.text || '');
    if (!prevId || !text) return;
    const prev = (window.chatSessions || []).find((s) => s.id === prevId);
    if (!prev) return;
    prev.history = Array.isArray(prev.history) ? prev.history : [];
    const last = prev.history.length > 0 ? prev.history[prev.history.length - 1] : null;
    if (!last || String(last.role || '') !== 'assistant' || String(last.content || '') !== text) {
      prev.history.push({ role: 'assistant', content: text });
    }
    prev.updatedAt = Date.now();
    saveChatSessions();
    if (typeof window.renderSessionsList === 'function') window.renderSessionsList();
    if (window.activeChatSessionId === prevId) renderChatMessages();
  };
  const ack = () => {
    if (msg.notificationId) {
      wsSend({ type: 'startup_notification_ack', notificationId: String(msg.notificationId) });
    }
  };
  if (msg.automatedSession && typeof window.upsertAutomatedSession === 'function') {
    window.upsertAutomatedSession(msg.automatedSession, { markUnread: true });
    appendToPreviousSession();
    const title = msg.automatedSession.title || msg.title || 'Automated session';
    bgtToast('💬 New automated session', String(title).slice(0, 100));
    ack();
    return;
  }

  // Backward-compatible fallback for additive session_notification payload.
  if (msg.sessionId && msg.text && typeof window.upsertAutomatedSession === 'function') {
    window.upsertAutomatedSession({
      id: msg.sessionId,
      title: msg.title || 'Automated session',
      history: [{ role: 'assistant', content: msg.text }],
      createdAt: Date.now(),
      automated: true,
      source: String(msg.source || ''),
    }, { markUnread: true });
    appendToPreviousSession();
    ack();
  }
});

function appendTelegramMessageToSession(sessionId, message) {
  const sid = String(sessionId || '').trim();
  if (!sid || !message || !message.role) return;
  const idx = (window.chatSessions || []).findIndex((s) => s.id === sid);
  if (idx < 0) return;
  const sess = window.chatSessions[idx];
  sess.history = Array.isArray(sess.history) ? sess.history : [];
  const next = {
    role: message.role === 'ai' ? 'assistant' : (message.role === 'assistant' ? 'assistant' : 'user'),
    content: String(message.content || ''),
    timestamp: Number(message.timestamp) || Date.now(),
    channel: 'telegram',
    channelLabel: 'telegram',
  };
  const last = sess.history.length > 0 ? sess.history[sess.history.length - 1] : null;
  if (
    last
    && String(last.role || '') === String(next.role || '')
    && String(last.content || '') === String(next.content || '')
    && String(last.channel || '').toLowerCase() === 'telegram'
  ) {
    return;
  }
  sess.history.push(next);
  sess.updatedAt = Date.now();
  sess.title = makeSessionTitle(sess.history);
  if (sid !== window.activeChatSessionId) sess.unread = true;
}

wsEventBus.on('telegram_message', (msg) => {
  const sid = String(msg?.sessionId || '').trim();
  if (!sid) return;
  const sessionExists = (window.chatSessions || []).some((s) => s.id === sid);
  if (!sessionExists) {
    window.chatSessions.push({
      id: sid,
      title: 'Telegram chat',
      history: [],
      processLog: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      automated: true,
      source: 'telegram_manual',
      unread: sid !== window.activeChatSessionId,
    });
  }
  appendTelegramMessageToSession(sid, msg.message);
  appendTelegramMessageToSession(sid, msg.responseMessage);
  saveChatSessions();
  if (typeof window.renderSessionsList === 'function') window.renderSessionsList();
  if (sid === window.activeChatSessionId) {
    syncActiveChat();
    renderChatMessages();
  }
});

wsEventBus.on('task_notification', (msg) => {
  if (!msg.sessionId) return;
  const notifMessage = msg.message || '';
  const notifSessionId = msg.sessionId;

  const sess = (window.chatSessions || []).find(s => s.id === notifSessionId);
  if (sess) {
    sess.history = sess.history || [];
    sess.history.push({ role: 'assistant', content: notifMessage });
    sess.updatedAt = Date.now();
    sess.unread = notifSessionId !== window.activeChatSessionId;
    saveChatSessions();
    if (typeof window.renderSessionsList === 'function') window.renderSessionsList();
    if (notifSessionId === window.activeChatSessionId) renderChatMessages();
    return;
  }

  if (notifSessionId === window.agentSessionId || notifSessionId === window.activeChatSessionId) {
    const activeSess = (window.chatSessions || []).find(s => s.id === window.activeChatSessionId);
    if (activeSess) {
      activeSess.history = activeSess.history || [];
      activeSess.history.push({ role: 'assistant', content: notifMessage });
      activeSess.updatedAt = Date.now();
      saveChatSessions();
      renderChatMessages();
      return;
    }
  }

  const taskTitle = msg.taskTitle || `Task — ${new Date().toLocaleTimeString()}`;
  const newSess = {
    id: notifSessionId, title: taskTitle,
    history: [{ role: 'assistant', content: notifMessage }],
    processLog: [], createdAt: Date.now(), updatedAt: Date.now(),
    automated: true, unread: true,
  };
  if (window.chatSessions) window.chatSessions.push(newSess);
  saveChatSessions();
  if (typeof window.renderSessionsList === 'function') window.renderSessionsList();
  bgtToast('💬 Task message', notifMessage.slice(0, 80));
});

wsEventBus.on('agent_spawned', (msg) => {
  const agentId = spawnAgentExecution(msg.name || 'Subagent', msg.task || '', msg.isSubagent);
  if (msg.serverAgentId) {
    if (!window.agentIdMap) window.agentIdMap = {};
    window.agentIdMap[msg.serverAgentId] = agentId;
  }
});
wsEventBus.on('agent_log', (msg) => {
  const agentId = window.agentIdMap?.[msg.serverAgentId] || msg.agentId;
  if (agentId) addAgentLog(agentId, msg.logType || 'info', msg.content);
});
wsEventBus.on('agent_completed', (msg) => {
  const agentId = window.agentIdMap?.[msg.serverAgentId] || msg.agentId;
  if (agentId) completeAgentExecution(agentId);
});
wsEventBus.on('agent_paused', (msg) => {
  const agentId = window.agentIdMap?.[msg.serverAgentId] || msg.agentId;
  if (agentId) pauseAgentExecution(agentId, msg.reason);
});

// ─── Background agent late-completion injection ───────────────
// When a background agent finishes AFTER the main turn's finalization gate
// already ran (or during the turn but after the done event), the server
// sends bg_agent_done via WebSocket with the full result. We inject it into
// the last AI message as a proper inner panel so it's visible to the user.
wsEventBus.on('bg_agent_done', (msg) => {
  if (msg.state !== 'completed' || !msg.result) return;
  // Only inject into the currently active session's history
  const activeSession = window.chatSessions?.find(s => s.id === window.activeChatSessionId);
  if (!activeSession) return;
  const history = activeSession.history || [];
  // Find the last AI message
  let lastAiIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'ai' || history[i].role === 'assistant') { lastAiIdx = i; break; }
  }
  if (lastAiIdx === -1) return;
  const lastMsg = history[lastAiIdx];
  const existingContent = String(lastMsg.content || '');
  // Don't double-inject — skip if already contains a background agent section
  if (/background agent response:/i.test(existingContent)) return;
  // Append the background agent inner panel marker
  history[lastAiIdx] = {
    ...lastMsg,
    content: existingContent.trim() + '\n\nBackground agent response:\n' + String(msg.result || ''),
  };
  persistActiveChat();
  renderChatMessages();
  addProcessEntry('info', `Background Agent ${msg.bgId}: result injected into reply.`, { actor: 'Background Agent' });
});

// ─── Coordinator progress: show team coordinator activity in process log ───
// When ask_team_coordinator runs (or the team coordinator is working), the backend
// broadcasts coordinator_progress WS events so the process log shows activity
// instead of appearing to hang silently.
wsEventBus.on('coordinator_progress', (msg) => {
  const matchesSession = msg.sessionId && msg.sessionId === window.activeChatSessionId;
  const isActiveRun = window.isThinking || matchesSession;
  if (!isActiveRun) return;
  const teamTag = msg.teamId ? ` [team:${msg.teamId}]` : '';
  addProcessEntry('info', `[coordinator${teamTag}] ${String(msg.message || '').slice(0, 200)}`, { actor: 'Coordinator' });
  renderProcessLog();
});

// ─── State sync: ensure window.* stays in sync ────────────────
// Wrap key functions to sync state before/after execution
