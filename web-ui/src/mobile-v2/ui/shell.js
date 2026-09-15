import { ICONS } from './icons.js';
import { attachMobileV2HapticGestureSurface, mobileV2Haptic } from './haptics.js';
import { sessionRef } from '../core/gateway-manager.js';

const ACTIVE_TAB_KEY = 'pm_mobile_v2_active_tab';
const ACTIVE_SESSION_KEY = 'pm_mobile_v2_active_session';
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
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function formatWhen(value) {
  const numeric = Number(new Date(value || 0));
  if (!numeric) return '';
  const delta = Math.max(0, Date.now() - numeric);
  if (delta < 60000) return 'now';
  if (delta < 3600000) return `${Math.floor(delta / 60000)}m`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)}h`;
  return `${Math.floor(delta / 86400000)}d`;
}

function sessionStamp(session) {
  return Number(new Date(session.updatedAt || session.lastActivityAt || session.lastMessageAt || session.createdAt || 0));
}

function readActiveSessionRef() {
  try { return String(localStorage.getItem(ACTIVE_SESSION_KEY) || ''); } catch { return ''; }
}

function readLastTab() {
  try { return String(sessionStorage.getItem(ACTIVE_TAB_KEY) || ''); } catch { return ''; }
}

function rememberTab(tab) {
  try { sessionStorage.setItem(ACTIVE_TAB_KEY, tab); } catch {}
}

function positionTabIndicator(tabbar, tabId, { animate = true } = {}) {
  const target = tabbar?.querySelector(`.pm-tab[data-tab="${tabId}"]`);
  const indicator = tabbar?.querySelector('.pm-tab-indicator');
  if (!target || !indicator) return;
  const place = () => {
    const left = target.offsetLeft;
    const width = target.offsetWidth;
    if (!width) return requestAnimationFrame(place);
    indicator.style.setProperty('--pm-ind-x', `${left}px`);
    indicator.style.setProperty('--pm-ind-w', `${width}px`);
    const center = left + width / 2;
    const barWidth = tabbar.offsetWidth;
    tabbar.style.setProperty('--pm-lens-x', `${center}px`);
    tabbar.style.setProperty('--pm-pill-left', `${left}px`);
    tabbar.style.setProperty('--pm-pill-right', `${Math.max(0, barWidth - (left + width))}px`);
    tabbar.style.setProperty('--pm-pill-span', `${width}px`);
    tabbar.style.setProperty('--pm-lens-r', `${width / 2}px`);
  };
  if (animate) {
    indicator.classList.add('is-moving');
    window.setTimeout(() => indicator.classList.remove('is-moving'), 520);
    requestAnimationFrame(place);
  } else {
    const previous = indicator.style.transition;
    indicator.style.transition = 'none';
    place();
    requestAnimationFrame(() => { indicator.style.transition = previous; });
  }
}

function wireLiquidTabbar(tabbar, { navigate, getActiveTab }) {
  let pointerId = null;
  let startX = 0;
  let lastX = 0;
  let lastSliderCenterX = 0;
  let velocity = 0;
  let dragging = false;
  let pendingTab = null;
  let requestGestureNativeHaptic = null;
  const PRESS_GROW = 1.22;
  const tabs = () => Array.from(tabbar.querySelectorAll('.pm-tab'));
  const indicator = () => tabbar.querySelector('.pm-tab-indicator');

  const tabAtX = (clientX) => {
    const rect = tabbar.getBoundingClientRect();
    const x = clientX - rect.left;
    let best = null;
    let bestDistance = Infinity;
    for (const tab of tabs()) {
      const center = tab.offsetLeft + tab.offsetWidth / 2;
      const distance = Math.abs(center - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = tab;
      }
    }
    return best;
  };

  const sliderCenterAtX = (clientX) => {
    const items = tabs();
    const first = items[0];
    const last = items[items.length - 1];
    const rect = tabbar.getBoundingClientRect();
    if (!first || !last) return Number(clientX) || 0;
    const min = rect.left + first.offsetLeft + first.offsetWidth / 2;
    const max = rect.left + last.offsetLeft + last.offsetWidth / 2;
    return Math.max(min, Math.min(max, Number(clientX) || min));
  };

  const setActive = (target) => {
    for (const tab of tabs()) {
      const active = tab === target;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    }
  };

  const follow = (clientX) => {
    const pill = indicator();
    const target = pendingTab || tabs()[0];
    if (!pill || !target) return;
    const rect = tabbar.getBoundingClientRect();
    const width = target.offsetWidth;
    const items = tabs();
    const first = items[0];
    const last = items[items.length - 1];
    let left = (clientX - rect.left) - width / 2;
    left = Math.max(first?.offsetLeft || 0, Math.min(last?.offsetLeft || 0, left));
    pill.style.setProperty('--pm-ind-x', `${left}px`);
    pill.style.setProperty('--pm-ind-w', `${width}px`);
    const center = left + width / 2;
    tabbar.style.setProperty('--pm-lens-x', `${center}px`);
    const stretch = 1 + Math.min(Math.abs(velocity) * 0.024, 0.42);
    const lean = Math.max(-22, Math.min(22, velocity * 0.9));
    const visualHalf = (width * stretch) / 2;
    tabbar.style.setProperty('--pm-pill-left', `${center - visualHalf}px`);
    tabbar.style.setProperty('--pm-pill-right', `${tabbar.offsetWidth - (center + visualHalf)}px`);
    tabbar.style.setProperty('--pm-pill-span', `${visualHalf * 2}px`);
    tabbar.style.setProperty('--pm-lens-r', `${visualHalf}px`);
    pill.style.transform = `translateX(${lean}px) scaleX(${stretch}) scaleY(${PRESS_GROW})`;
  };

  const settle = (target) => {
    const pill = indicator();
    if (!pill || !target) return;
    const left = target.offsetLeft;
    const width = target.offsetWidth;
    const center = left + width / 2;
    pill.style.setProperty('--pm-ind-x', `${left}px`);
    pill.style.setProperty('--pm-ind-w', `${width}px`);
    tabbar.style.setProperty('--pm-lens-x', `${center}px`);
    tabbar.style.setProperty('--pm-pill-left', `${left}px`);
    tabbar.style.setProperty('--pm-pill-right', `${tabbar.offsetWidth - (left + width)}px`);
    tabbar.style.setProperty('--pm-pill-span', `${width}px`);
    tabbar.style.setProperty('--pm-lens-r', `${width / 2}px`);
    pill.style.transform = '';
  };

  const pulseCrossings = (from, to) => {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return;
    const right = to > from;
    const rect = tabbar.getBoundingClientRect();
    for (const tab of tabs()) {
      const center = rect.left + tab.offsetLeft + tab.offsetWidth / 2;
      const crossed = right ? (center > from && center <= to) : (center < from && center >= to);
      if (crossed) {
        requestGestureNativeHaptic?.();
        mobileV2Haptic(8);
      }
    }
  };

  const finish = (event, cancelled = false) => {
    if (pointerId == null || (event?.pointerId !== undefined && event.pointerId !== pointerId)) return;
    const wasDragging = dragging;
    pointerId = null;
    dragging = false;
    velocity = 0;
    tabbar.classList.remove('pm-tabbar-dragging', 'pm-tabbar-pressing');
    if (cancelled) {
      pendingTab = null;
      requestGestureNativeHaptic = null;
      settle(tabbar.querySelector('.pm-tab.active'));
      return;
    }
    const target = event && Number.isFinite(event.clientX) ? tabAtX(event.clientX) : pendingTab;
    if (!target) return;
    if (!wasDragging) mobileV2Haptic(8);
    const id = target.dataset.tab;
    const current = getActiveTab();
    setActive(target);
    settle(target);
    pendingTab = null;
    requestGestureNativeHaptic = null;
    if (id && id !== current) window.setTimeout(() => navigate(id), 90);
  };

  const disposeHaptic = attachMobileV2HapticGestureSurface(tabbar, {
    onPointerDown(event, gesture) {
      const target = tabAtX(event.clientX);
      if (!target) return;
      pointerId = event.pointerId;
      startX = lastX = event.clientX;
      lastSliderCenterX = sliderCenterAtX(event.clientX);
      velocity = 0;
      dragging = false;
      pendingTab = target;
      requestGestureNativeHaptic = gesture?.requestNativeHaptic || null;
      tabbar.classList.add('pm-tabbar-pressing');
      const pill = indicator();
      if (pill) pill.style.transform = `scaleY(${PRESS_GROW})`;
    },
    onPointerMove(event, gesture) {
      if (pointerId == null || event.pointerId !== pointerId) return;
      requestGestureNativeHaptic = gesture?.requestNativeHaptic || requestGestureNativeHaptic;
      const previousCenter = lastSliderCenterX;
      velocity = event.clientX - lastX;
      lastX = event.clientX;
      lastSliderCenterX = sliderCenterAtX(event.clientX);
      if (!dragging) {
        if (Math.abs(event.clientX - startX) < 6) return;
        dragging = true;
        tabbar.classList.add('pm-tabbar-dragging');
      }
      pulseCrossings(previousCenter, lastSliderCenterX);
      const nearest = tabAtX(event.clientX);
      if (nearest && nearest !== pendingTab) {
        pendingTab = nearest;
        setActive(nearest);
      }
      follow(event.clientX);
    },
    onPointerUp: (event) => finish(event, false),
    onPointerCancel: (event) => finish(event, true),
    nativeHapticsOnMove: false,
  });

  return disposeHaptic;
}

export function createMobileV2Shell({ root, gateways }) {
  let navigate = () => {};
  let drawerOpen = false;
  let activeTab = readLastTab() || 'chat';
  let sessions = [];
  let disposed = false;

  root.innerHTML = `<div class="pm-app pm-v2-app" id="pm-v2-app">
    <section class="pm-drawer pm-v2-drawer" id="pm-v2-drawer" aria-hidden="true">
      <div class="pm-v2-drawer-top"><button class="pm-icon-btn pm-v2-drawer-close" type="button" aria-label="Close menu">${ICONS.menu}</button><div class="pm-v2-drawer-brand">Prometheus</div><button class="pm-icon-btn" type="button" data-v2-connections aria-label="Gateway Connections">${ICONS.users}</button></div>
      <div class="pm-v2-gateway-strip" data-v2-gateway-strip></div>
      <button class="pm-drawer-new-chat pm-v2-new-chat" type="button">${ICONS.plus}<span>New chat</span></button>
      <div class="pm-v2-drawer-label">Chats</div>
      <div class="pm-drawer-list pm-v2-session-list" id="pm-v2-session-list"></div>
      <div class="pm-v2-drawer-label pm-v2-nav-label">Prometheus</div>
      <nav class="pm-drawer-list pm-v2-drawer-nav" aria-label="Prometheus sections">${DRAWER_ITEMS.map((item) => `<button class="pm-drawer-item pm-v2-drawer-item" type="button" data-drawer-route="${item.id}"><span class="pm-flex"><span class="pm-v2-drawer-icon">${ICONS[item.icon]}</span><span>${item.label}</span></span><span class="pm-v2-session-chevron">${ICONS.chevron}</span></button>`).join('')}</nav>
    </section>
    <div class="pm-page pm-v2-page" id="pm-v2-page"><header class="pm-header pm-v2-header"><button class="pm-icon-btn pm-v2-menu" type="button" aria-label="Open menu">${ICONS.menu}</button><div class="pm-v2-header-center"><div class="pm-v2-brand">Prometheus</div></div><button class="pm-online pm-v2-status" id="pm-v2-status" type="button"><span class="pm-v2-status-dot"></span><span>Checking</span></button></header><main class="pm-body pm-v2-body" id="pm-v2-page-slot"></main></div>
    <nav class="pm-tabbar pm-v2-tabbar" id="pm-v2-tabbar" role="tablist" aria-label="Primary navigation"><span class="pm-tabbar-sheen" aria-hidden="true"></span><span class="pm-glass-lens" aria-hidden="true"></span><span class="pm-glass-border" aria-hidden="true"></span><span class="pm-tab-indicator" aria-hidden="true"></span>${TABS.map((tab) => `<button class="pm-tab${tab.id === activeTab ? ' active' : ''}" type="button" data-tab="${tab.id}" role="tab" aria-label="${tab.label}" aria-selected="${String(tab.id === activeTab)}">${ICONS[tab.icon]}<input type="checkbox" switch class="pm-haptic-switch-overlay" aria-hidden="true" tabindex="-1"></button>`).join('')}<div class="pm-tab-magnify" aria-hidden="true">${TABS.map((tab) => `<div class="pm-tab-magnify-cell">${ICONS[tab.icon]}</div>`).join('')}</div></nav>
    <div class="pm-v2-notice" id="pm-v2-notice" hidden></div>
  </div>`;

  const page = root.querySelector('#pm-v2-page-slot');
  const drawer = root.querySelector('#pm-v2-drawer');
  const list = root.querySelector('#pm-v2-session-list');
  const tabbar = root.querySelector('#pm-v2-tabbar');
  const status = root.querySelector('#pm-v2-status');
  const notice = root.querySelector('#pm-v2-notice');
  const gatewayStrip = root.querySelector('[data-v2-gateway-strip]');

  const disposeSlider = wireLiquidTabbar(tabbar, {
    navigate: (route) => navigate(route),
    getActiveTab: () => activeTab,
  });

  function setDrawer(open) {
    drawerOpen = !!open;
    drawer.classList.toggle('open', drawerOpen);
    drawer.setAttribute('aria-hidden', drawerOpen ? 'false' : 'true');
    document.body.classList.toggle('pm-v2-drawer-open', drawerOpen);
    if (drawerOpen) {
      refreshSessions();
      refreshGatewayStrip();
    }
  }

  function setActiveTab(tabId) {
    const next = TABS.some((tab) => tab.id === tabId) ? tabId : 'chat';
    const changed = next !== activeTab;
    activeTab = next;
    tabbar?.querySelectorAll('.pm-tab').forEach((button) => {
      const on = button.dataset.tab === activeTab;
      button.classList.toggle('active', on);
      button.setAttribute('aria-selected', String(on));
    });
    rememberTab(activeTab);
    requestAnimationFrame(() => positionTabIndicator(tabbar, activeTab, { animate: changed }));
  }

  function refreshGatewayStrip() {
    const rows = gateways.list();
    gatewayStrip.innerHTML = rows.map((entry) => `<button type="button" class="pm-v2-gateway-pill${entry.id === gateways.activeId ? ' active' : ''}" data-gateway-id="${escapeHtml(entry.id)}"><span class="pm-v2-gateway-dot ${escapeHtml(entry.status || 'unknown')}"></span>${escapeHtml(entry.name)}</button>`).join('');
  }

  function renderSessions() {
    const active = readActiveSessionRef();
    list.innerHTML = sessions.length ? sessions.map((session) => {
      const isActive = active && session._ref === active;
      return `<button class="pm-session-row pm-v2-session-row${isActive ? ' is-active-session' : ''}" type="button" data-session-ref="${escapeHtml(session._ref)}"${isActive ? ' aria-current="page"' : ''}><span class="pm-v2-session-copy"><strong>${escapeHtml(session.title || session.name || 'Untitled chat')}</strong><small><span class="pm-session-gateway">${escapeHtml(session._gatewayName)}</span>${formatWhen(session.updatedAt || session.lastActivityAt || session.createdAt) ? ` · ${formatWhen(session.updatedAt || session.lastActivityAt || session.createdAt)}` : ''}</small></span><span class="pm-v2-session-chevron">${ICONS.chevron}</span></button>`;
    }).join('') : '<div class="pm-v2-drawer-empty">No chats yet.</div>';
  }

  async function refreshSessions() {
    list.innerHTML = '<div class="pm-v2-drawer-empty">Loading chats…</div>';
    const results = await Promise.allSettled(gateways.list().map(async (entry) => {
      const result = await gateways.client(entry.id).listSessions({ state: 'all', limit: 80 });
      return result.sessions.map((session) => ({
        ...session,
        _gatewayId: entry.id,
        _gatewayName: entry.name,
        _ref: sessionRef(entry.id, session.id),
      }));
    }));
    if (disposed) return;
    sessions = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []).sort((a, b) => sessionStamp(b) - sessionStamp(a));
    renderSessions();
  }

  async function newChat() {
    const gateway = gateways.active;
    const id = `mobile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await gateway.createSession({ id, title: 'New Chat' });
      const ref = gateways.bindSession(id, gateway.id) || sessionRef(gateway.id, id);
      try { localStorage.setItem(ACTIVE_SESSION_KEY, ref); } catch {}
      setDrawer(false);
      navigate(`chat/${encodeURIComponent(ref)}`);
      refreshSessions();
    } catch (error) {
      showNotice(error?.message || 'Could not create a new chat.');
    }
  }

  async function refreshStatus() {
    const entry = await gateways.probe(gateways.activeId);
    if (disposed || !entry) return;
    status.classList.toggle('offline', entry.status !== 'online');
    status.lastElementChild.textContent = entry.status === 'online' ? entry.name : (entry.status === 'revoked' ? 'Reconnect' : 'Offline');
    refreshGatewayStrip();
  }

  function showNotice(message) {
    notice.textContent = String(message || '');
    notice.hidden = !message;
    if (message) window.setTimeout(() => {
      if (notice.textContent === message) notice.hidden = true;
    }, 6000);
  }

  root.querySelector('.pm-v2-menu')?.addEventListener('click', () => setDrawer(true));
  root.querySelector('.pm-v2-drawer-close')?.addEventListener('click', () => setDrawer(false));
  root.querySelector('.pm-v2-new-chat')?.addEventListener('click', newChat);
  root.querySelector('[data-v2-connections]')?.addEventListener('click', () => { setDrawer(false); navigate('gateways'); });
  status?.addEventListener('click', () => navigate('gateways'));
  list?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-session-ref]');
    if (!row) return;
    try { localStorage.setItem(ACTIVE_SESSION_KEY, row.dataset.sessionRef); } catch {}
    renderSessions();
    setDrawer(false);
    navigate(`chat/${encodeURIComponent(row.dataset.sessionRef)}`);
  });
  drawer?.addEventListener('click', (event) => {
    const routeButton = event.target.closest('[data-drawer-route]');
    if (routeButton) {
      setDrawer(false);
      navigate(routeButton.dataset.drawerRoute);
      return;
    }
    const gatewayButton = event.target.closest('[data-gateway-id]');
    if (gatewayButton) {
      gateways.select(gatewayButton.dataset.gatewayId);
      refreshGatewayStrip();
      refreshStatus();
      refreshSessions();
    }
  });
  tabbar?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button && event.detail === 0) navigate(button.dataset.tab);
  });
  window.addEventListener('resize', () => positionTabIndicator(tabbar, activeTab, { animate: false }), { passive: true });
  gateways.addEventListener('change', refreshStatus);

  requestAnimationFrame(() => {
    tabbar?.querySelectorAll('.pm-tab').forEach((tab) => tab.style.setProperty('--pm-tab-left-px', `${tab.offsetLeft}px`));
    positionTabIndicator(tabbar, activeTab, { animate: false });
  });
  refreshStatus();

  return {
    page,
    gateways,
    navigate(route) { navigate(route); },
    setNavigate(callback) { navigate = callback || (() => {}); },
    setActiveTab,
    setDrawer,
    refreshSessions,
    refreshStatus,
    showNotice,
    setTitle(title) {
      const brand = root.querySelector('.pm-v2-brand');
      if (brand) brand.textContent = title || 'Prometheus';
    },
    dispose() {
      disposed = true;
      disposeSlider?.();
      gateways.removeEventListener('change', refreshStatus);
    },
  };
}
