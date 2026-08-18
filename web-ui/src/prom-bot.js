import { api } from './api.js';

// Prom Bot is a desktop shell mode, not a second subagent runtime. It exposes
// each existing single-thread subagent chat in the primary chat area while the
// Subagents page continues to own streaming, approvals, files, voice, and
// reasoning state.
const PROM_BOT_MODE_KEY = 'prometheus_prom_bot_mode_v1';
const PROM_BOT_COLLAPSED_KEY = 'prometheus_prom_bot_section_collapsed_v1';
const PROM_BOT_BUTTON_ID = 'sidebarPromBotToggle';
const PROM_BOT_SECTION_ID = 'prom-bot-sidebar-section';
const PROM_BOT_LIST_ID = 'prom-bot-subagents-list';
const PROM_BOT_HOST_ID = 'prom-bot-chat-host';

let promBotMode = false;
let promBotAgents = [];
let activePromBotAgentId = '';
let promBotRefreshPromise = null;
let subagentRuntimePromise = null;
let originalBoardParent = null;
let originalBoardNextSibling = null;
let sidebarCaptureBound = false;

const ROBOT_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="5" width="8" height="7" rx="2"/><circle cx="6" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r="1" fill="currentColor" stroke="none"/><line x1="8" y1="2" x2="8" y2="5"/><circle cx="8" cy="1.5" r="1" fill="currentColor" stroke="none"/></svg>`;

function readBool(key, fallback = false) {
  try {
    const value = localStorage.getItem(key);
    if (value == null) return fallback;
    return value === '1' || value === 'true';
  } catch {
    return fallback;
  }
}

function writeBool(key, value) {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch {}
}

function installPromBotStyles() {
  if (document.getElementById('prom-bot-styles')) return;
  const style = document.createElement('style');
  style.id = 'prom-bot-styles';
  style.textContent = `
    #${PROM_BOT_BUTTON_ID}.prom-bot-active {
      color: var(--pm-gold, var(--brand));
      background: var(--sidebar-active-bg, rgba(214,183,94,.14));
      border-color: color-mix(in srgb, var(--pm-gold, var(--brand)) 48%, transparent);
    }
    #${PROM_BOT_BUTTON_ID} svg { width: 20px; height: 20px; }
    #${PROM_BOT_SECTION_ID}[hidden] { display: none !important; }
    #${PROM_BOT_LIST_ID} { display: flex; flex-direction: column; gap: 2px; }
    .prom-bot-agent-row {
      width: 100%;
      display: grid;
      grid-template-columns: 30px minmax(0,1fr) auto;
      align-items: center;
      gap: 9px;
      padding: 8px 9px;
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: var(--sidebar-text, var(--text));
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: background .14s ease, color .14s ease;
    }
    .prom-bot-agent-row:hover { background: var(--sidebar-item-hover, var(--panel-2)); }
    .prom-bot-agent-row.active { background: var(--sidebar-active-bg, var(--panel-2)); color: var(--text); }
    .prom-bot-agent-avatar {
      width: 30px;
      height: 30px;
      border-radius: 9px;
      display: grid;
      place-items: center;
      color: var(--pm-gold, var(--brand));
      background: var(--sidebar-icon-bg, var(--panel-2));
      border: 1px solid var(--sidebar-icon-border, var(--line));
    }
    .prom-bot-agent-avatar svg { width: 17px; height: 17px; }
    .prom-bot-agent-copy { min-width: 0; }
    .prom-bot-agent-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 780; }
    .prom-bot-agent-meta { display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--sidebar-muted, var(--muted)); font-size: 10px; font-weight: 560; }
    .prom-bot-agent-state { width: 6px; height: 6px; border-radius: 50%; background: color-mix(in srgb, var(--sidebar-muted, var(--muted)) 60%, transparent); }
    .prom-bot-agent-state.working { background: #36c986; box-shadow: 0 0 0 3px rgba(54,201,134,.12); }
    .prom-bot-sidebar-empty { padding: 8px 10px 12px; color: var(--sidebar-muted, var(--muted)); font-size: 11px; line-height: 1.45; }
    #chat-view.prom-bot-chat-active { position: relative; min-height: 0; }
    #${PROM_BOT_HOST_ID} {
      position: absolute;
      inset: 0;
      z-index: 12;
      display: flex;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      background: var(--pm-chat-page-bg, var(--bg));
    }
    #${PROM_BOT_HOST_ID} #subagent-board {
      display: flex !important;
      flex: 1 1 auto;
      width: 100% !important;
      height: 100%;
      min-width: 0;
      min-height: 0;
      opacity: 1 !important;
      border-left: 0 !important;
      background: transparent !important;
    }
    #${PROM_BOT_HOST_ID} #subagent-board-header { display: none !important; }
    #${PROM_BOT_HOST_ID} #subagent-board-body { flex: 1 1 auto; min-height: 0; }
    #${PROM_BOT_HOST_ID} .unified-agent-chat-shell { width: 100%; height: 100%; min-height: 0; }
    #${PROM_BOT_HOST_ID} .unified-agent-chat-header .side-chat-close { display: none !important; }
  `;
  document.head.appendChild(style);
}

function ensurePromBotButton() {
  let button = document.getElementById(PROM_BOT_BUTTON_ID);
  if (button) return button;
  const priorityButton = document.getElementById('sidebarPriorityToggle');
  const searchButton = document.getElementById('sidebarSearchToggle');
  if (!priorityButton?.parentElement || searchButton?.parentElement !== priorityButton.parentElement) return null;
  button = document.createElement('button');
  button.className = 'sidebar-header-btn prom-bot-toggle';
  button.id = PROM_BOT_BUTTON_ID;
  button.type = 'button';
  button.title = 'Prom Bot';
  button.setAttribute('aria-label', 'Turn on Prom Bot mode');
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML = ROBOT_ICON;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setPromBotMode(!promBotMode);
  });
  priorityButton.parentElement.insertBefore(button, priorityButton);
  return button;
}

function ensurePromBotSection() {
  let section = document.getElementById(PROM_BOT_SECTION_ID);
  if (section) return section;
  const pinnedSection = document.getElementById('sidebar-pinned-section');
  if (!pinnedSection?.parentElement) return null;

  section = document.createElement('div');
  section.className = 'sidebar-section prom-bot-sidebar-section';
  section.id = PROM_BOT_SECTION_ID;
  section.hidden = true;

  const header = document.createElement('button');
  header.className = 'section-title sidebar-section-toggle';
  header.type = 'button';
  header.setAttribute('aria-controls', PROM_BOT_LIST_ID);
  const collapsed = readBool(PROM_BOT_COLLAPSED_KEY, false);
  header.setAttribute('aria-expanded', String(!collapsed));
  header.innerHTML = '<span>Subagents</span><span class="sidebar-section-decoration" aria-hidden="true"><span class="sidebar-section-icon">✦</span></span>';

  const list = document.createElement('div');
  list.id = PROM_BOT_LIST_ID;
  list.className = 'session-list';
  list.hidden = collapsed;

  header.addEventListener('click', () => {
    const nextCollapsed = !list.hidden;
    list.hidden = nextCollapsed;
    header.setAttribute('aria-expanded', String(!nextCollapsed));
    writeBool(PROM_BOT_COLLAPSED_KEY, nextCollapsed);
  });

  section.append(header, list);
  pinnedSection.parentElement.insertBefore(section, pinnedSection);
  return section;
}

function agentModelLabel(agent) {
  const model = String(agent?.effectiveModel || agent?.model || '').trim();
  if (!model) return 'Direct subagent chat';
  return model.includes('/') ? model.split('/').pop() : model;
}

function renderPromBotAgents() {
  const list = document.getElementById(PROM_BOT_LIST_ID);
  if (!list) return;
  list.replaceChildren();

  if (!promBotAgents.length) {
    const empty = document.createElement('div');
    empty.className = 'prom-bot-sidebar-empty';
    empty.textContent = 'No subagents configured.';
    list.appendChild(empty);
    return;
  }

  for (const agent of promBotAgents) {
    const id = String(agent?.id || '').trim();
    if (!id) continue;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'prom-bot-agent-row';
    row.dataset.agentId = id;
    row.classList.toggle('active', id === activePromBotAgentId);
    row.setAttribute('aria-current', id === activePromBotAgentId ? 'page' : 'false');

    const avatar = document.createElement('span');
    avatar.className = 'prom-bot-agent-avatar';
    avatar.innerHTML = ROBOT_ICON;

    const copy = document.createElement('span');
    copy.className = 'prom-bot-agent-copy';
    const name = document.createElement('span');
    name.className = 'prom-bot-agent-name';
    name.textContent = String(agent?.name || id);
    const meta = document.createElement('span');
    meta.className = 'prom-bot-agent-meta';
    meta.textContent = agentModelLabel(agent);
    copy.append(name, meta);

    const state = document.createElement('span');
    state.className = `prom-bot-agent-state${agent?.lastRun?.inProgress ? ' working' : ''}`;
    state.title = agent?.lastRun?.inProgress ? 'Working' : 'Ready';
    state.setAttribute('aria-label', state.title);

    row.append(avatar, copy, state);
    row.addEventListener('click', () => void openPromBotAgent(id));
    list.appendChild(row);
  }
}

async function refreshPromBotAgents({ force = false } = {}) {
  if (promBotRefreshPromise && !force) return promBotRefreshPromise;
  promBotRefreshPromise = (async () => {
    try {
      const data = await api('/api/agents', { timeoutMs: 8000 });
      // Match the Subagents page: real configured agents only; team membership
      // does not create a second identity or chat thread.
      promBotAgents = (Array.isArray(data?.agents) ? data.agents : [])
        .filter((agent) => agent && !agent.default && !agent.isSynthetic);
      renderPromBotAgents();
      return promBotAgents;
    } catch (error) {
      const list = document.getElementById(PROM_BOT_LIST_ID);
      if (list) {
        list.replaceChildren();
        const empty = document.createElement('div');
        empty.className = 'prom-bot-sidebar-empty';
        empty.textContent = 'Could not load subagents.';
        list.appendChild(empty);
      }
      console.warn('[Prom Bot] Failed to load subagents:', error);
      return [];
    } finally {
      promBotRefreshPromise = null;
    }
  })();
  return promBotRefreshPromise;
}

async function ensureSubagentRuntime() {
  if (!subagentRuntimePromise) {
    subagentRuntimePromise = Promise.all([
      import('./pages/SubagentsPage.js'),
      window.__PROM_UNIFIED_DESKTOP_CHAT ? Promise.resolve() : import('./pages/ChatPage.js'),
    ]).then(() => {
      if (typeof window.openSubagentDetail !== 'function' || typeof window.switchSubagentTab !== 'function') {
        throw new Error('Subagent chat runtime is unavailable.');
      }
      return true;
    }).catch((error) => {
      subagentRuntimePromise = null;
      throw error;
    });
  }
  return subagentRuntimePromise;
}

function getPromBotHost() {
  let host = document.getElementById(PROM_BOT_HOST_ID);
  if (host) return host;
  const chatView = document.getElementById('chat-view');
  if (!chatView) return null;
  host = document.createElement('div');
  host.id = PROM_BOT_HOST_ID;
  host.setAttribute('role', 'region');
  host.setAttribute('aria-label', 'Prom Bot direct chat');
  chatView.appendChild(host);
  return host;
}

function mountSubagentBoardInMainChat() {
  const board = document.getElementById('subagent-board');
  const chatView = document.getElementById('chat-view');
  const host = getPromBotHost();
  if (!board || !chatView || !host) throw new Error('Prom Bot chat surface is unavailable.');

  if (!originalBoardParent) {
    originalBoardParent = board.parentNode;
    originalBoardNextSibling = board.nextSibling;
  }
  if (board.parentNode !== host) host.appendChild(board);
  board.style.display = 'flex';
  board.style.width = '100%';
  board.style.opacity = '1';
  board.style.borderLeft = '0';
  chatView.classList.add('prom-bot-chat-active');
}

function restoreSubagentBoard() {
  const board = document.getElementById('subagent-board');
  if (board && originalBoardParent && board.parentNode !== originalBoardParent) {
    if (originalBoardNextSibling?.parentNode === originalBoardParent) originalBoardParent.insertBefore(board, originalBoardNextSibling);
    else originalBoardParent.appendChild(board);
  }
  document.getElementById(PROM_BOT_HOST_ID)?.remove();
  document.getElementById('chat-view')?.classList.remove('prom-bot-chat-active');
}

function closePromBotChat({ keepMode = true } = {}) {
  if (!activePromBotAgentId && !document.getElementById(PROM_BOT_HOST_ID)) return;
  restoreSubagentBoard();
  activePromBotAgentId = '';
  window.promBotActiveAgentId = '';
  renderPromBotAgents();
  try { window.closeSubagentDetail?.(); } catch (error) { console.warn('[Prom Bot] Could not close subagent detail:', error); }
  if (!keepMode) setPromBotMode(false);
}

async function openPromBotAgent(agentId) {
  const id = String(agentId || '').trim();
  if (!id) return;
  if (!promBotMode) setPromBotMode(true);

  try {
    await ensureSubagentRuntime();
    if (!promBotAgents.some((agent) => String(agent?.id || '') === id)) await refreshPromBotAgents({ force: true });

    // Keep the ordinary Prometheus session untouched underneath this surface.
    // Switching back to a pinned/project/chat therefore restores it instantly.
    if (typeof window.setMode === 'function') window.setMode('chat');
    await window.openSubagentDetail(id);
    await window.switchSubagentTab('chat', id);
    mountSubagentBoardInMainChat();

    activePromBotAgentId = id;
    window.promBotActiveAgentId = id;
    renderPromBotAgents();
    requestAnimationFrame(() => document.getElementById('subagent-chat-input')?.focus({ preventScroll: true }));
  } catch (error) {
    console.error('[Prom Bot] Could not open subagent chat:', error);
    restoreSubagentBoard();
    activePromBotAgentId = '';
    window.promBotActiveAgentId = '';
    renderPromBotAgents();
    if (typeof window.showToast === 'function') window.showToast('Prom Bot', error?.message || 'Could not open subagent chat.', 'error');
  }
}

function syncPromBotControls() {
  const button = ensurePromBotButton();
  const section = ensurePromBotSection();
  if (button) {
    button.classList.toggle('prom-bot-active', promBotMode);
    button.setAttribute('aria-pressed', String(promBotMode));
    button.setAttribute('aria-label', promBotMode ? 'Turn off Prom Bot mode' : 'Turn on Prom Bot mode');
    button.title = promBotMode ? 'Prom Bot · On' : 'Prom Bot';
  }
  if (section) section.hidden = !promBotMode;
}

function setPromBotMode(enabled, { persist = true } = {}) {
  promBotMode = enabled === true;
  window.promBotMode = promBotMode;
  if (persist) writeBool(PROM_BOT_MODE_KEY, promBotMode);
  syncPromBotControls();
  if (promBotMode) void refreshPromBotAgents();
  else closePromBotChat({ keepMode: true });
  return promBotMode;
}

function bindSidebarExitCapture() {
  if (sidebarCaptureBound) return;
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebarCaptureBound = true;
  sidebar.addEventListener('click', (event) => {
    if (!activePromBotAgentId) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest(`#${PROM_BOT_BUTTON_ID}`) || target.closest(`#${PROM_BOT_SECTION_ID}`)) return;
    // Search/Priority are temporary sidebar overlays, not chat destinations.
    if (target.closest('.sidebar-header-btn')) return;
    closePromBotChat({ keepMode: true });
  }, true);
}

function initPromBot() {
  installPromBotStyles();
  ensurePromBotButton();
  ensurePromBotSection();
  bindSidebarExitCapture();
  setPromBotMode(readBool(PROM_BOT_MODE_KEY, false), { persist: false });
}

window.setPromBotMode = setPromBotMode;
window.togglePromBotMode = () => setPromBotMode(!promBotMode);
window.refreshPromBotAgents = refreshPromBotAgents;
window.openPromBotAgent = openPromBotAgent;
window.closePromBotChat = closePromBotChat;
window.promBotActiveAgentId = '';
window.promBotMode = false;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPromBot, { once: true });
else initPromBot();
