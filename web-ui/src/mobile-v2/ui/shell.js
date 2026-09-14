import { ICONS } from './icons.js';

const TABS = [
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'voice', label: 'Voice', icon: 'mic' },
  { id: 'tasks', label: 'Tasks', icon: 'clipboard' },
  { id: 'hub', label: 'Hub', icon: 'person' },
];

const DRAWER_ITEMS = [
  { id: 'schedule', label: 'Schedule', icon: 'calendar' },
  { id: 'teams', label: 'Teams', icon: 'users' },
  { id: 'subagents', label: 'Subagents', icon: 'robot' },
  { id: 'proposals', label: 'Proposals', icon: 'doc' },
  { id: 'more', label: 'More', icon: 'dots' },
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function formatWhen(value) {
  const numeric = Number(value || 0);
  if (!numeric) return '';
  const delta = Math.max(0, Date.now() - numeric);
  if (delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}

export function createMobileV2Shell({ root, gateway }) {
  let navigate = () => {};
  let drawerOpen = false;
  let activeTab = 'chat';
  let sessions = [];

  root.innerHTML = `
    <div class="pm-app pm-v2-app" id="pm-v2-app">
      <section class="pm-drawer pm-v2-drawer" id="pm-v2-drawer" aria-hidden="true">
        <div class="pm-v2-drawer-top">
          <button class="pm-icon-btn pm-v2-drawer-close" type="button" aria-label="Close menu">${ICONS.menu}</button>
          <div class="pm-v2-drawer-brand">Prometheus</div>
        </div>
        <button class="pm-drawer-new-chat pm-v2-new-chat" type="button">${ICONS.plus}<span>New chat</span></button>
        <div class="pm-v2-drawer-label">Chats</div>
        <div class="pm-drawer-list pm-v2-session-list" id="pm-v2-session-list"></div>
        <div class="pm-v2-drawer-label pm-v2-nav-label">Prometheus</div>
        <nav class="pm-drawer-list pm-v2-drawer-nav" aria-label="Prometheus sections">
          ${DRAWER_ITEMS.map((item) => `<button class="pm-drawer-item pm-v2-drawer-item" type="button" data-drawer-route="${item.id}"><span class="pm-flex"><span class="pm-v2-drawer-icon">${ICONS[item.icon]}</span><span>${item.label}</span></span><span class="pm-v2-session-chevron">${ICONS.chevron}</span></button>`).join('')}
        </nav>
      </section>
      <div class="pm-page pm-v2-page" id="pm-v2-page">
        <header class="pm-header pm-v2-header">
          <button class="pm-icon-btn pm-v2-menu" type="button" aria-label="Open menu">${ICONS.menu}</button>
          <div class="pm-v2-header-center">
            <div class="pm-v2-brand">Prometheus</div>
          </div>
          <div class="pm-online pm-v2-status" id="pm-v2-status"><span class="pm-v2-status-dot"></span><span>Online</span></div>
        </header>
        <main class="pm-body pm-v2-body" id="pm-v2-page-slot"></main>
      </div>
      <nav class="pm-tabbar pm-v2-tabbar" id="pm-v2-tabbar" aria-label="Primary navigation">
        <span class="pm-tab-indicator" aria-hidden="true"></span>
        ${TABS.map((tab) => `<button class="pm-tab${tab.id === activeTab ? ' active' : ''}" type="button" data-tab="${tab.id}" aria-label="${tab.label}"><span class="pm-tab-icon">${ICONS[tab.icon]}</span><span class="pm-tab-label">${tab.label}</span></button>`).join('')}
      </nav>
      <div class="pm-v2-notice" id="pm-v2-notice" hidden></div>
    </div>`;

  const page = root.querySelector('#pm-v2-page-slot');
  const drawer = root.querySelector('#pm-v2-drawer');
  const list = root.querySelector('#pm-v2-session-list');
  const tabbar = root.querySelector('#pm-v2-tabbar');
  const status = root.querySelector('#pm-v2-status');
  const notice = root.querySelector('#pm-v2-notice');

  function setDrawer(open) {
    drawerOpen = !!open;
    drawer.classList.toggle('open', drawerOpen);
    drawer.setAttribute('aria-hidden', drawerOpen ? 'false' : 'true');
    document.body.classList.toggle('pm-v2-drawer-open', drawerOpen);
  }

  function positionIndicator() {
    const target = tabbar?.querySelector(`.pm-tab[data-tab="${activeTab}"]`);
    const indicator = tabbar?.querySelector('.pm-tab-indicator');
    if (!target || !indicator) return;
    indicator.style.setProperty('--pm-ind-x', `${target.offsetLeft}px`);
    indicator.style.setProperty('--pm-ind-w', `${target.offsetWidth}px`);
    tabbar.style.setProperty('--pm-lens-x', `${target.offsetLeft + target.offsetWidth / 2}px`);
  }

  function setActiveTab(tabId) {
    activeTab = TABS.some((tab) => tab.id === tabId) ? tabId : 'chat';
    tabbar?.querySelectorAll('.pm-tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === activeTab));
    requestAnimationFrame(positionIndicator);
  }

  function renderSessions() {
    list.innerHTML = sessions.length ? sessions.map((session) => {
      const id = String(session.id || '');
      const title = escapeHtml(session.title || session.name || 'Untitled chat');
      const when = formatWhen(session.updatedAt || session.lastActivityAt || session.createdAt);
      return `<button class="pm-session-row pm-v2-session-row" type="button" data-session-id="${escapeHtml(id)}"><span class="pm-v2-session-copy"><strong>${title}</strong><small>${when}</small></span><span class="pm-v2-session-chevron">${ICONS.chevron}</span></button>`;
    }).join('') : '<div class="pm-v2-drawer-empty">No chats yet.</div>';
  }

  async function refreshSessions() {
    list.innerHTML = '<div class="pm-v2-drawer-empty">Loading chats…</div>';
    try {
      const result = await gateway.listSessions({ state: 'all', limit: 80 });
      sessions = result.sessions || [];
      renderSessions();
    } catch (error) {
      list.innerHTML = `<div class="pm-v2-drawer-empty">${escapeHtml(error?.message || 'Could not load chats.')}</div>`;
    }
  }

  async function newChat() {
    const id = `mobile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await gateway.createSession({ id, title: 'New Chat' });
      setDrawer(false);
      navigate(`chat/${encodeURIComponent(id)}`);
      refreshSessions().catch(() => {});
    } catch (error) {
      showNotice(error?.message || 'Could not create a new chat.');
    }
  }

  function showNotice(message) {
    notice.textContent = String(message || '');
    notice.hidden = !message;
    if (message) window.setTimeout(() => { if (notice.textContent === message) notice.hidden = true; }, 6000);
  }

  root.querySelector('.pm-v2-menu')?.addEventListener('click', () => { setDrawer(true); refreshSessions(); });
  root.querySelector('.pm-v2-drawer-close')?.addEventListener('click', () => setDrawer(false));
  root.querySelector('.pm-v2-new-chat')?.addEventListener('click', () => newChat());
  list?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-session-id]');
    if (!row) return;
    setDrawer(false);
    navigate(`chat/${encodeURIComponent(row.dataset.sessionId)}`);
  });
  drawer?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-drawer-route]');
    if (!button) return;
    setDrawer(false);
    navigate(button.dataset.drawerRoute);
  });
  tabbar?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button) navigate(button.dataset.tab);
  });
  window.addEventListener('resize', positionIndicator, { passive: true });

  gateway.health().then(() => {
    status.classList.remove('offline');
    status.lastElementChild.textContent = 'Online';
  }).catch(() => {
    status.classList.add('offline');
    status.lastElementChild.textContent = 'Offline';
  });

  requestAnimationFrame(positionIndicator);

  return {
    page,
    gateway,
    setNavigate(callback) { navigate = callback || (() => {}); },
    setActiveTab,
    setDrawer,
    refreshSessions,
    showNotice,
    setTitle(title) {
      const brand = root.querySelector('.pm-v2-brand');
      if (brand) brand.textContent = title || 'Prometheus';
    },
  };
}
