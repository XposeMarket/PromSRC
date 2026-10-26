import { api } from './api.js';
import { renderAgentPet, renderAgentPetStack, rememberAgentPets } from './components/agent-pets.js';

// Prom Bot is a desktop shell mode, not a second subagent runtime. It exposes
// each existing single-thread subagent chat in the primary chat area while the
// Subagents page continues to own streaming, approvals, files, voice, and
// reasoning state.
const PROM_BOT_MODE_KEY = 'prometheus_prom_bot_mode_v1';
const PROM_BOT_COLLAPSED_KEY = 'prometheus_prom_bot_section_collapsed_v1';
const PROM_BOT_BUTTON_ID = 'sidebarPromBotToggle';
const PROM_BOT_SECTION_ID = 'prom-bot-sidebar-section';
const PROM_BOT_LIST_ID = 'prom-bot-subagents-list';
const PROM_BOT_SURFACE_ID = 'prom-bot-main-surface';
const PROM_BOT_TEAMS_LIST_ID = 'prom-bot-teams-list';
const TEAM_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="5.5" cy="5.5" r="2"/><circle cx="11" cy="6" r="1.7"/><path d="M1.8 13c.4-2.2 1.9-3.4 3.7-3.4s3.3 1.2 3.7 3.4"/><path d="M9.6 9.9c.4-.2.9-.3 1.4-.3 1.5 0 2.7 1 3 2.9"/></svg>`;

let promBotMode = false;
let promBotAgents = [];
let promBotTeams = [];
let activePromBotAgentId = '';
let activePromBotTeamId = '';
let promBotRefreshPromise = null;
let promBotTeamsRefreshPromise = null;
let subagentRuntimePromise = null;
let teamsRuntimePromise = null;
// Board id -> its home in the DOM. Prom Bot borrows the Subagents board
// (#subagent-board) or the Teams board (#team-board) and puts it back on close.
const boardHomes = new Map();
let displacedMainChatChildren = [];
let sidebarCaptureBound = false;

const ROBOT_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="5" width="8" height="7" rx="2"/><circle cx="6" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r="1" fill="currentColor" stroke="none"/><line x1="8" y1="2" x2="8" y2="5"/><circle cx="8" cy="1.5" r="1" fill="currentColor" stroke="none"/></svg>`;

function setPromChatTitleOverride(title, subtitle = '', source = 'prom-bot') {
  const sessionId = String(window.activeChatSessionId || window.state?.activeChatSessionId || window.agentSessionId || '').trim();
  if (!sessionId) return;
  window.__PROM_CHAT_TITLE_OVERRIDE = {
    sessionId,
    title: String(title || '').trim(),
    subtitle: String(subtitle || '').trim(),
    source,
  };
  window.syncChatTopbarTitle?.();
  if (typeof window.refreshPromMultiChatTabs === 'function') window.refreshPromMultiChatTabs();
  else window.dispatchEvent(new CustomEvent('prometheus:chat-title-override-changed'));
}

function clearPromChatTitleOverride(source = '') {
  const current = window.__PROM_CHAT_TITLE_OVERRIDE;
  if (!current || (source && current.source !== source)) return;
  delete window.__PROM_CHAT_TITLE_OVERRIDE;
  window.syncChatTopbarTitle?.();
  if (typeof window.refreshPromMultiChatTabs === 'function') window.refreshPromMultiChatTabs();
  else window.dispatchEvent(new CustomEvent('prometheus:chat-title-override-changed'));
}

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
    #${PROM_BOT_LIST_ID}[hidden] { display: none !important; }
    #${PROM_BOT_SECTION_ID}.is-collapsed > :not(.sidebar-section-toggle) { display: none !important; }
    #${PROM_BOT_TEAMS_LIST_ID} { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
    #${PROM_BOT_TEAMS_LIST_ID}:empty { display: none; }
    .prom-bot-teams-label { padding:3px 8px 4px; font-size:9px; font-weight:800; letter-spacing:.11em; text-transform:uppercase; color:var(--sidebar-muted,var(--muted)); }
    .prom-bot-team-avatar { font-size: 15px; line-height: 1; }
    .prom-bot-agent-state.paused { opacity: .45; }
    /* Inside Prom Bot the team board is the chat; its close button would
       blank the surface, so the sidebar is the way out. */
    #${PROM_BOT_SURFACE_ID}[data-kind="team"] #team-board-header button[onclick="closeTeamBoard()"] { display: none !important; }
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

    /* Prom Bot is the main chat surface while an agent is selected. Do not
       stack a second absolute chat panel over the existing conversation. */
    #chat-view.prom-bot-chat-active {
      display: flex !important;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    /* The regular chat children have authored display rules (for example
       #chat-messages is a flex scroller), so the browser's bare [hidden]
       attribute cannot reliably suppress them. Prom Bot must leave exactly
       one visible surface in #chat-view. */
    #chat-view.prom-bot-chat-active > [hidden],
    #chat-view.prom-bot-group-active > [hidden] {
      display: none !important;
    }
    #${PROM_BOT_SURFACE_ID} {
      position: relative;
      display: flex;
      flex: 1 1 auto;
      width: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      background: transparent;
    }
    #${PROM_BOT_SURFACE_ID} #subagent-board {
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
    #${PROM_BOT_SURFACE_ID} #subagent-board-header { display: none !important; }
    #${PROM_BOT_SURFACE_ID} #subagent-board-body { flex: 1 1 auto; min-height: 0; }
    #${PROM_BOT_SURFACE_ID} .unified-agent-chat-shell { width: 100%; height: 100%; min-height: 0; }
    #${PROM_BOT_SURFACE_ID} .unified-agent-chat-header { display: none !important; }
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
  section.classList.toggle('is-collapsed', collapsed);
  header.setAttribute('aria-expanded', String(!collapsed));
  header.innerHTML = '<span>Subagents</span><span class="sidebar-section-decoration" aria-hidden="true"><span class="sidebar-section-icon">✦</span></span>';

  const list = document.createElement('div');
  list.id = PROM_BOT_LIST_ID;
  list.className = 'session-list';
  list.hidden = collapsed;

  header.addEventListener('click', () => {
    const nextCollapsed = !list.hidden;
    list.hidden = nextCollapsed;
    section.classList.toggle('is-collapsed', nextCollapsed);
    header.setAttribute('aria-expanded', String(!nextCollapsed));
    writeBool(PROM_BOT_COLLAPSED_KEY, nextCollapsed);
  });

  const teamsList = document.createElement('div');
  teamsList.id = PROM_BOT_TEAMS_LIST_ID;
  teamsList.className = 'prom-bot-teams-list';

  section.append(header, list, teamsList);
  pinnedSection.parentElement.insertBefore(section, pinnedSection);
  return section;
}

function teamSearchQuery() {
  return String(document.getElementById('prom-bot-roster-search')?.value || '').trim().toLowerCase();
}

function renderPromBotTeams() {
  const host = document.getElementById(PROM_BOT_TEAMS_LIST_ID);
  if (!host) return;
  host.replaceChildren();
  const query = teamSearchQuery();
  const visible = promBotTeams.filter((team) => {
    if (!query) return true;
    return `${team?.name || ''} ${team?.description || ''}`.toLowerCase().includes(query);
  });
  if (!visible.length) return;

  const label = document.createElement('div');
  label.className = 'prom-bot-teams-label';
  label.textContent = 'Teams';
  host.appendChild(label);

  for (const team of visible) {
    const id = String(team?.id || '').trim();
    if (!id) continue;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'prom-bot-agent-row prom-bot-team-row';
    row.dataset.teamId = id;
    row.classList.toggle('active', id === activePromBotTeamId);
    row.setAttribute('aria-current', id === activePromBotTeamId ? 'page' : 'false');

    const avatar = document.createElement('span');
    avatar.className = 'prom-bot-agent-avatar prom-bot-team-avatar';
    avatar.innerHTML = renderAgentPetStack(Array.isArray(team?.subagentIds) ? team.subagentIds : [], { size: 14, max: 3 });

    const copy = document.createElement('span');
    copy.className = 'prom-bot-agent-copy';
    const name = document.createElement('span');
    name.className = 'prom-bot-agent-name';
    name.textContent = String(team?.name || id);
    const meta = document.createElement('span');
    meta.className = 'prom-bot-agent-meta';
    const members = Array.isArray(team?.subagentIds) ? team.subagentIds.length : 0;
    const paused = team?.manager?.paused === true;
    meta.textContent = `${members} member${members === 1 ? '' : 's'} + manager${paused ? ' · paused' : ''}`;
    copy.append(name, meta);

    const state = document.createElement('span');
    state.className = `prom-bot-agent-state${paused ? ' paused' : ''}`;
    state.title = paused ? 'Paused' : 'Ready';
    state.setAttribute('aria-label', state.title);

    row.append(avatar, copy, state);
    row.addEventListener('click', () => void openPromBotTeam(id));
    host.appendChild(row);
  }
}

async function refreshPromBotTeams({ force = false } = {}) {
  if (promBotTeamsRefreshPromise && !force) return promBotTeamsRefreshPromise;
  promBotTeamsRefreshPromise = (async () => {
    try {
      const data = await api('/api/teams', { timeoutMs: 8000 });
      promBotTeams = Array.isArray(data?.teams) ? data.teams.filter((team) => team && team.id) : [];
    } catch (error) {
      // Teams are additive to the roster; a failed fetch keeps the last list.
      console.warn('[Prom Bot] Failed to load teams:', error);
    } finally {
      promBotTeamsRefreshPromise = null;
    }
    renderPromBotTeams();
    return promBotTeams;
  })();
  return promBotTeamsRefreshPromise;
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
    avatar.innerHTML = renderAgentPet(agent, { size: 18 });

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
      rememberAgentPets(Array.isArray(data?.agents) ? data.agents : []);
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

function getPromBotSurface() {
  let surface = document.getElementById(PROM_BOT_SURFACE_ID);
  if (surface) return surface;
  const chatView = document.getElementById('chat-view');
  if (!chatView) return null;
  surface = document.createElement('div');
  surface.id = PROM_BOT_SURFACE_ID;
  surface.setAttribute('role', 'region');
  surface.setAttribute('aria-label', 'Prom Bot direct chat');
  chatView.appendChild(surface);
  return surface;
}

function displaceMainChatSurface(chatView, surface) {
  if (displacedMainChatChildren.length) return;
  displacedMainChatChildren = Array.from(chatView.children)
    .filter((node) => node !== surface)
    .map((node) => ({
      node,
      hidden: node.hidden === true,
      ariaHidden: node.getAttribute('aria-hidden'),
    }));
  for (const entry of displacedMainChatChildren) {
    entry.node.hidden = true;
    entry.node.setAttribute('aria-hidden', 'true');
  }
}

function restoreMainChatSurface() {
  for (const entry of displacedMainChatChildren) {
    if (!entry.node?.isConnected) continue;
    entry.node.hidden = entry.hidden;
    if (entry.ariaHidden == null) entry.node.removeAttribute('aria-hidden');
    else entry.node.setAttribute('aria-hidden', entry.ariaHidden);
  }
  displacedMainChatChildren = [];
}

function restoreBoardHome(boardId) {
  const home = boardHomes.get(boardId);
  const board = document.getElementById(boardId);
  if (board && home?.parent && board.parentNode !== home.parent) {
    if (home.next?.parentNode === home.parent) home.parent.insertBefore(board, home.next);
    else home.parent.appendChild(board);
  }
  boardHomes.delete(boardId);
}

function mountBoardAsMainChatSurface(boardId, kind) {
  const board = document.getElementById(boardId);
  const chatView = document.getElementById('chat-view');
  const surface = getPromBotSurface();
  if (!board || !chatView || !surface) throw new Error('Prom Bot chat surface is unavailable.');

  // Only one borrowed board is mounted at a time.
  for (const otherId of Array.from(boardHomes.keys())) {
    if (otherId !== boardId) restoreBoardHome(otherId);
  }
  if (!boardHomes.has(boardId)) boardHomes.set(boardId, { parent: board.parentNode, next: board.nextSibling });
  displaceMainChatSurface(chatView, surface);
  if (board.parentNode !== surface) surface.appendChild(board);
  board.style.display = 'flex';
  board.style.width = '100%';
  board.style.opacity = '1';
  board.style.borderLeft = '0';
  surface.dataset.kind = kind;
  chatView.classList.add('prom-bot-chat-active');
}

function mountSubagentBoardAsMainChatSurface() {
  mountBoardAsMainChatSurface('subagent-board', 'subagent');
}

function restoreBorrowedBoards() {
  for (const boardId of Array.from(boardHomes.keys())) restoreBoardHome(boardId);
  restoreMainChatSurface();
  document.getElementById(PROM_BOT_SURFACE_ID)?.remove();
  document.getElementById('chat-view')?.classList.remove('prom-bot-chat-active');
}

// Back-compat name used by older callers.
const restoreSubagentBoard = restoreBorrowedBoards;

function closePromBotChat({ keepMode = true } = {}) {
  if (!activePromBotAgentId && !activePromBotTeamId && !document.getElementById(PROM_BOT_SURFACE_ID)) {
    clearPromChatTitleOverride('prom-bot');
    return;
  }
  const hadTeam = !!activePromBotTeamId || boardHomes.has('team-board');
  const hadAgent = !!activePromBotAgentId || boardHomes.has('subagent-board') || !hadTeam;
  restoreBorrowedBoards();
  clearPromChatTitleOverride('prom-bot');
  activePromBotAgentId = '';
  activePromBotTeamId = '';
  window.promBotActiveAgentId = '';
  window.promBotActiveTeamId = '';
  renderPromBotAgents();
  renderPromBotTeams();
  if (hadAgent) {
    try { window.closeSubagentDetail?.(); } catch (error) { console.warn('[Prom Bot] Could not close subagent detail:', error); }
  }
  if (hadTeam) {
    // Stops team chat polling and resets the Teams page board state.
    try { window.closeTeamBoard?.(); } catch (error) { console.warn('[Prom Bot] Could not close team board:', error); }
  }
  if (!keepMode) setPromBotMode(false);
}

async function ensureTeamsRuntime() {
  if (!teamsRuntimePromise) {
    teamsRuntimePromise = import('./pages/TeamsPage.js').then(() => {
      if (typeof window.openTeamBoard !== 'function' || typeof window.switchTeamTab !== 'function') {
        throw new Error('Team chat runtime is unavailable.');
      }
      return true;
    }).catch((error) => {
      teamsRuntimePromise = null;
      throw error;
    });
  }
  return teamsRuntimePromise;
}

async function openPromBotTeam(teamId) {
  const id = String(teamId || '').trim();
  if (!id) return;
  if (!promBotMode) setPromBotMode(true);

  try {
    window.closePromBotGroup?.();
    // Team -> team switches reuse the mounted board: closeTeamBoard() hides
    // the board on a 350ms timer, which would blank the next team's chat.
    if (activePromBotAgentId) closePromBotChat({ keepMode: true });
    await ensureTeamsRuntime();
    if (typeof window.setMode === 'function') window.setMode('chat');
    // TeamsPage owns team state (teamsData, room state, streaming, composer).
    // Hydrate it from the Chat page the same way Prom Bot hydrates Subagents.
    await window.refreshTeams?.();
    const teams = Array.isArray(window.teamsData) ? window.teamsData : [];
    const team = teams.find((candidate) => String(candidate?.id || '') === id);
    if (!team) throw new Error('That team no longer exists.');
    await window.openTeamBoard(id);
    await window.switchTeamTab('chat', id);
    mountBoardAsMainChatSurface('team-board', 'team');

    activePromBotTeamId = id;
    window.promBotActiveTeamId = id;
    setPromChatTitleOverride(team.name || id, 'Prom Bot · Team chat', 'prom-bot');
    renderPromBotAgents();
    renderPromBotTeams();
    void refreshPromBotTeams({ force: true });
    requestAnimationFrame(() => document.getElementById('team-chat-input')?.focus({ preventScroll: true }));
  } catch (error) {
    console.error('[Prom Bot] Could not open team chat:', error);
    restoreBorrowedBoards();
    clearPromChatTitleOverride('prom-bot');
    activePromBotTeamId = '';
    window.promBotActiveTeamId = '';
    renderPromBotTeams();
    if (typeof window.showToast === 'function') window.showToast('Prom Bot', error?.message || 'Could not open team chat.', 'error');
  }
}

async function openPromBotAgent(agentId) {
  const id = String(agentId || '').trim();
  if (!id) return;
  if (!promBotMode) setPromBotMode(true);

  try {
    // Direct and group rooms share the primary chat surface; never leave a
    // group host mounted behind the direct Prom Bot surface during a switch.
    window.closePromBotGroup?.();
    if (activePromBotTeamId) closePromBotChat({ keepMode: true });
    await ensureSubagentRuntime();
    if (!promBotAgents.some((agent) => String(agent?.id || '') === id)) await refreshPromBotAgents({ force: true });

    // Prom Bot takes over the existing main chat region instead of creating an
    // absolutely-positioned chat layer above it. The durable subagent runtime
    // still owns transport/state; only the visible host changes.
    if (typeof window.setMode === 'function') window.setMode('chat');
    // SubagentsPage normally hydrates its private catalog from page activation.
    // Prom Bot opens from the Chat page, so hydrate that same catalog before
    // openSubagentDetail() asks it to find the selected agent. Without this,
    // the board exists but renders no chat surface or composer.
    await window.refreshSubagents?.();
    await window.openSubagentDetail(id);
    await window.switchSubagentTab('chat', id);
    mountSubagentBoardAsMainChatSurface();

    activePromBotAgentId = id;
    window.promBotActiveAgentId = id;
    const agent = promBotAgents.find((candidate) => String(candidate?.id || '') === id);
    setPromChatTitleOverride(agent?.name || id, 'Prom Bot · Subagent chat', 'prom-bot');
    renderPromBotAgents();
    requestAnimationFrame(() => document.getElementById('subagent-chat-input')?.focus({ preventScroll: true }));
  } catch (error) {
    console.error('[Prom Bot] Could not open subagent chat:', error);
    restoreSubagentBoard();
    clearPromChatTitleOverride('prom-bot');
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
  if (promBotMode) {
    void refreshPromBotAgents();
    void refreshPromBotTeams();
  } else {
    window.closePromBotGroup?.();
    closePromBotChat({ keepMode: true });
  }
  return promBotMode;
}

function bindSidebarExitCapture() {
  if (sidebarCaptureBound) return;
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebarCaptureBound = true;
  sidebar.addEventListener('click', (event) => {
    if (!activePromBotAgentId && !activePromBotTeamId) return;
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
  // The roster search box is created later by prom-bot-roster.js; delegate.
  document.addEventListener('input', (event) => {
    if (event.target instanceof Element && event.target.id === 'prom-bot-roster-search') renderPromBotTeams();
  });
  setPromBotMode(readBool(PROM_BOT_MODE_KEY, false), { persist: false });
}

window.setPromBotMode = setPromBotMode;
window.togglePromBotMode = () => setPromBotMode(!promBotMode);
window.refreshPromBotAgents = refreshPromBotAgents;
window.openPromBotAgent = openPromBotAgent;
window.refreshPromBotTeams = refreshPromBotTeams;
window.openPromBotTeam = openPromBotTeam;
window.closePromBotChat = closePromBotChat;
window.promBotActiveTeamId = '';
window.setPromChatTitleOverride = setPromChatTitleOverride;
window.clearPromChatTitleOverride = clearPromChatTitleOverride;
window.promBotActiveAgentId = '';
window.promBotMode = false;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPromBot, { once: true });
else initPromBot();
