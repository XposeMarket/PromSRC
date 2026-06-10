// Mobile shell — header, drawer, bottom tabbar. Pure DOM helpers.
import { mobileNavTabs, mobileDrawerItems } from './mobile-data.js';
import { timeAgo } from '../utils.js';
import { initMobileModelBadge, mobileModelBadgeSeedLabel } from './mobile-model-badge.js';

// Small SVG icon set inlined so we don't depend on external icon loaders for this view.
export const ICONS = {
  menu:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="7"  x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="14" y2="17"/></svg>',
  gear:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  back:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
  chat:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  mic:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/></svg>',
  spark:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/><path d="M19 5l1 1M5 5l-1 1"/></svg>',
  calendar:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>',
  users:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  robot:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="12" rx="3"/><circle cx="9" cy="13" r="1.4"/><circle cx="15" cy="13" r="1.4"/><line x1="12" y1="3" x2="12" y2="7"/><line x1="2" y1="13" x2="4" y2="13"/><line x1="20" y1="13" x2="22" y2="13"/></svg>',
  doc:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 13 12 16 17 11"/></svg>',
  dots:      '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
  chev:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  fork:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M6 8v2a4 4 0 0 0 4 4h2"/><path d="M18 8v2a4 4 0 0 1-4 4h-2"/><path d="M12 14v2"/></svg>',
  refresh:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.5 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.65 4.36A9 9 0 0 0 20.5 15"/></svg>',
  plus:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  play:      '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
  pause:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>',
  trash:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  clock:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
  paperclip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.49"/></svg>',
  send:      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>',
  micSmall:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg>',
  pin:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 2h6l-1 6 4 4-3 3H9l-3-3 4-4z"/></svg>',
  brain:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3a3 3 0 0 0-3 3v12a3 3 0 0 0 5 2 3 3 0 0 0 5-2V6a3 3 0 0 0-5-2 3 3 0 0 0-2-1z"/></svg>',
  monitor:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  globe:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/></svg>',
  upload:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  check:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  target:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>',
  moon:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.8 6.8 0 0 0 9.8 9.8z"/></svg>',
  sun:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  image:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  video:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
  layers:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 18l9 5 9-5"/></svg>',
  preset:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 14.9 8.6 22 9.3 16.6 14 18.2 21 12 17.4 5.8 21 7.4 14 2 9.3 9.1 8.6 12 2"/></svg>',
  download:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  eye:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  hf:        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>',
  wand:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9"/></svg>',
};

export function icon(name, cls = '') {
  return `<span class="pm-i ${cls}" aria-hidden="true">${ICONS[name] || ''}</span>`;
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html).trim();
  return t.content.firstElementChild;
}

let _drawerEl = null;
let _scrimEl = null;
let _drawerSearch = '';
let _drawerSearchTimer = null;
let _drawerSearchSeq = 0;
let _tabResizeHandlerBound = false;
const PM_DRAWER_STATE_KEY = 'pm_mobile_drawer_sessions_view';
const PM_THEME_KEY = 'prometheus_theme';
const PM_ACTIVE_TAB_KEY = 'pm_mobile_active_tab';
const PM_DRAWER_SESSION_PAGE_SIZE = 20;
const _drawerSessionPaging = {
  mobile: { sessions: [], total: 0, offset: 0, hasMore: false, loading: false, initialized: false },
  channels: {},
};

function _newDrawerPageState() {
  return { sessions: [], total: 0, offset: 0, hasMore: false, loading: false, initialized: false, pending: null };
}

function _drawerPageStateFor(channel = 'mobile') {
  const key = String(channel || 'mobile');
  if (key === 'mobile') return _drawerSessionPaging.mobile;
  if (!_drawerSessionPaging.channels[key]) _drawerSessionPaging.channels[key] = _newDrawerPageState();
  return _drawerSessionPaging.channels[key];
}

function _resetDrawerPageState(channel = '') {
  if (!channel) {
    _drawerSessionPaging.mobile = _newDrawerPageState();
    _drawerSessionPaging.channels = {};
    return;
  }
  if (channel === 'mobile') _drawerSessionPaging.mobile = _newDrawerPageState();
  else delete _drawerSessionPaging.channels[channel];
}

export function invalidateMobileDrawerSessions(channel = '') {
  _resetDrawerPageState(channel);
}

function _currentDrawerSessionChannel() {
  const state = _loadDrawerState();
  if (state.view !== 'channelChats') return 'mobile';
  const channel = String(state.channel || '').trim();
  return channel || 'mobile';
}

function _isDrawerSideChatSession(session) {
  const id = String(session?.id || '').trim();
  return /^side_/i.test(id) || session?.sideChat === true || !!String(session?.parentSessionId || '').trim();
}

async function _loadDrawerSessionPage({ channel = 'mobile', loadSessions, reset = false } = {}) {
  const state = _drawerPageStateFor(channel);
  if (state.loading) return state.pending || state;
  if (!reset && state.initialized && !state.hasMore) return state;
  state.loading = true;
  state.error = '';
  const offset = reset ? 0 : (state.initialized ? state.offset : 0);
  state.pending = (async () => {
    try {
      const loader = typeof loadSessions?.loadPage === 'function'
        ? loadSessions.loadPage
        : null;
      let page;
      if (loader) {
        page = await loader({ channel, limit: PM_DRAWER_SESSION_PAGE_SIZE, offset });
      } else if (typeof loadSessions === 'function') {
        const data = await loadSessions({ channel, limit: PM_DRAWER_SESSION_PAGE_SIZE, offset });
        const list = channel === 'mobile'
          ? (Array.isArray(data?.mobile) ? data.mobile : [])
          : (Array.isArray(data?.channels) ? (data.channels.find((c) => c.key === channel)?.sessions || []) : []);
        page = { sessions: list, total: list.length, offset, hasMore: false };
      } else {
        page = { sessions: [], total: 0, offset, hasMore: false };
      }

      const incoming = (Array.isArray(page?.sessions) ? page.sessions : []).filter((session) => !_isDrawerSideChatSession(session));
      const seen = new Set(reset ? [] : state.sessions.map((s) => String(s?.id || '')));
      const merged = reset ? [] : state.sessions.slice();
      for (const session of incoming) {
        const id = String(session?.id || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        merged.push(session);
      }
      state.sessions = merged;
      state.total = Math.max(merged.length, Math.floor(Number(page?.total || merged.length) || merged.length));
      state.offset = Math.max(0, Math.floor(Number(page?.offset || offset) || offset)) + incoming.length;
      state.hasMore = page?.hasMore === true || state.offset < state.total;
      state.initialized = true;
    } catch (err) {
      console.warn('[mobile drawer] Failed to load session page', { channel, offset, err });
      state.error = err?.message || 'Could not load sessions.';
      state.initialized = true;
      state.hasMore = false;
    } finally {
      state.loading = false;
      state.pending = null;
    }
    return state;
  })();
  return state.pending;
}


function _getTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  if (current === 'dark' || current === 'light') return current;
  try {
    const saved = localStorage.getItem(PM_THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {}
  return 'dark';
}

function _applyMobileTheme(theme) {
  const resolved = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', resolved);
  try { localStorage.setItem(PM_THEME_KEY, resolved); } catch {}

  const desktopToggle = document.getElementById('theme-toggle');
  if (desktopToggle) {
    desktopToggle.setAttribute('data-theme-state', resolved);
    const title = resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    desktopToggle.title = title;
    desktopToggle.setAttribute('aria-label', title);
  }

  const mobileToggle = _drawerEl?.querySelector('[data-mobile-theme-toggle]');
  if (mobileToggle) {
    const isDark = resolved === 'dark';
    mobileToggle.innerHTML = isDark ? ICONS.sun : ICONS.moon;
    mobileToggle.setAttribute('aria-pressed', String(isDark));
    mobileToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    mobileToggle.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  }
}

function _toggleMobileTheme() {
  _applyMobileTheme(_getTheme() === 'dark' ? 'light' : 'dark');
}

function _tabIndex(tabId) {
  return Math.max(0, mobileNavTabs.findIndex((tab) => tab.id === tabId));
}

function _rememberActiveTab(activeTab) {
  if (!activeTab) return;
  try { sessionStorage.setItem(PM_ACTIVE_TAB_KEY, activeTab); } catch {}
}

function _lastActiveTab() {
  try { return sessionStorage.getItem(PM_ACTIVE_TAB_KEY) || ''; } catch { return ''; }
}

// Position the sliding glass pill exactly over a tab button by measuring its
// real layout box. Percentages on `transform: translateX` are relative to the
// element's own width, so we drive `left`/`width` in pixels instead.
function _positionTabIndicator(tabbar, tabId, { animate = true } = {}) {
  if (!tabbar) return;
  const target = tabbar.querySelector(`.pm-tab[data-tab="${tabId}"]`);
  const indicator = tabbar.querySelector('.pm-tab-indicator');
  if (!target || !indicator) return;
  const place = () => {
    const left = target.offsetLeft;
    const width = target.offsetWidth;
    if (!width) { window.requestAnimationFrame(place); return; }
    indicator.style.setProperty('--pm-ind-x', `${left}px`);
    indicator.style.setProperty('--pm-ind-w', `${width}px`);
  };
  if (animate) {
    indicator.classList.add('is-moving');
    window.setTimeout(() => indicator.classList.remove('is-moving'), 520);
    window.requestAnimationFrame(place);
  } else {
    // Skip the transition on first paint / resize so it just snaps into place.
    const prev = indicator.style.transition;
    indicator.style.transition = 'none';
    place();
    window.requestAnimationFrame(() => { indicator.style.transition = prev; });
  }
}

function _loadDrawerState() {
  try {
    const raw = JSON.parse(localStorage.getItem(PM_DRAWER_STATE_KEY) || '{}');
    const view = raw?.view === 'channels' || raw?.view === 'channelChats' ? raw.view : 'mobile';
    return { view, channel: String(raw?.channel || '') };
  } catch {
    return { view: 'mobile', channel: '' };
  }
}

function _saveDrawerState(state) {
  try { localStorage.setItem(PM_DRAWER_STATE_KEY, JSON.stringify(state || { view: 'mobile', channel: '' })); } catch {}
}

export function createMobileShell({ activeTab, onNavigate, onNewChat, onOpenSession, loadSessions, searchSessions }) {
  const root = document.getElementById('mobile-root');
  root.innerHTML = '';
  root.hidden = false;

  const app = el(`<div class="pm-app" id="pm-app"></div>`);
  root.appendChild(app);

  // Drawer + scrim live inside .pm-app (absolute positioned)
  _scrimEl = el(`<div class="pm-drawer-scrim" aria-hidden="true"></div>`);
  _drawerEl = el(`
    <aside class="pm-drawer" role="dialog" aria-label="Menu" aria-modal="true">
      <div class="pm-drawer-brand"><span class="pm-brand-flame">🔥</span><span>Prometheus</span></div>
      <button class="pm-theme-toggle" type="button" data-mobile-theme-toggle aria-label="Toggle dark mode"></button>
      <label class="pm-drawer-search" aria-label="Search chats">
        ${_searchIcon()}
        <input id="pm-drawer-search-input" type="search" autocomplete="off" spellcheck="false" placeholder="Search chats..." value="">
      </label>
      <div class="pm-drawer-top-actions">
        <button class="pm-drawer-new-chat" type="button" data-mobile-new-chat aria-label="New chat">
          <span class="pm-icon">${ICONS.plus}</span>
          <span>New chat</span>
        </button>
      </div>
      <nav class="pm-drawer-list">
        ${mobileDrawerItems.map(it => `
          <button class="pm-drawer-item" data-route="${it.route}">
            <span class="pm-icon">${ICONS[it.icon] || ''}</span>
            <span class="pm-flex">${escapeHtml(it.label)}</span>
            <span class="pm-chev">${ICONS.chev}</span>
          </button>
        `).join('')}
      </nav>
      <section class="pm-drawer-sessions" id="pm-drawer-sessions" aria-label="Sessions">
        <div class="pm-drawer-divider"></div>
        <div class="pm-drawer-session-head" id="pm-drawer-session-head"></div>
        <div class="pm-drawer-session-list" id="pm-mobile-session-list"><div class="pm-session-empty">Loading...</div></div>
      </section>
      <section class="pm-drawer-search-results" id="pm-drawer-search-results" aria-label="Search results" hidden>
        <div class="pm-drawer-section-title">Search Results</div>
        <div class="pm-drawer-session-list" id="pm-mobile-search-list"></div>
      </section>
      <div id="pm-install-slot" style="margin-top:auto;"></div>
    </aside>
  `);
  app.appendChild(_scrimEl);
  app.appendChild(_drawerEl);

  // Shell-level delegated fallback for the hamburger. Per-page code also wires
  // this via wireHeaderActions(), but if a page's render throws before that
  // call, the menu would otherwise stop opening — this guarantees it always
  // works. openDrawer() is idempotent, so the double-wiring is harmless.
  app.addEventListener('click', (ev) => {
    const menuBtn = ev.target?.closest?.('[data-action="menu"]');
    if (menuBtn && app.contains(menuBtn)) openDrawer();
  });

  _scrimEl.addEventListener('click', closeDrawer);
  _drawerEl.querySelectorAll('.pm-drawer-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const route = btn.getAttribute('data-route');
      closeDrawer();
      if (typeof onNavigate === 'function') onNavigate(route);
    });
  });
  _drawerEl.querySelector('[data-mobile-new-chat]')?.addEventListener('click', () => {
    closeDrawer();
    Promise.resolve(typeof onNewChat === 'function' ? onNewChat() : null)
      .then(() => {
        _saveDrawerState({ view: 'mobile', channel: '' });
        _resetDrawerPageState('mobile');
      })
      .catch(() => {});
  });
  _drawerEl.querySelector('[data-mobile-theme-toggle]')?.addEventListener('click', _toggleMobileTheme);
  _drawerEl.querySelector('#pm-drawer-search-input')?.addEventListener('input', (ev) => {
    _drawerSearch = String(ev.target?.value || '').trim();
    _renderDrawerSearchState({ onOpenSession, loadSessions, searchSessions, onNewChat });
  });
  _applyMobileTheme(_getTheme());
  _renderDrawerSessions({ onOpenSession, loadSessions, searchSessions, onNewChat });

  document.addEventListener('keydown', _escHandler, { passive: true });
  _renderInstallSlot();
  initMobileModelBadge();

  // Page slot (header + body live in here, replaced per page)
  const page = el(`<div class="pm-page" id="pm-page" style="display:flex;flex-direction:column;flex:1;min-height:0;"></div>`);
  app.appendChild(page);

  // Tabbar
  const previousTab = _lastActiveTab();
  const shouldAnimateTab = !!activeTab && !!previousTab && previousTab !== activeTab;
  const tabbar = el(`
    <nav
      class="pm-tabbar"
      role="tablist"
      aria-label="Primary"
    >
      <span class="pm-tabbar-sheen" aria-hidden="true"></span>
      <span class="pm-tab-indicator" aria-hidden="true"></span>
    </nav>
  `);
  mobileNavTabs.forEach(tab => {
    const b = el(`
      <button class="pm-tab ${tab.id === activeTab ? 'active' : ''}" data-tab="${tab.id}" role="tab" aria-label="${escapeHtml(tab.label)}" aria-selected="${tab.id === activeTab ? 'true' : 'false'}">
        ${ICONS[tab.icon] || ''}
        <span>${escapeHtml(tab.label)}</span>
      </button>
    `);
    b.addEventListener('click', () => {
      const currentTab = tabbar.querySelector('.pm-tab.active')?.getAttribute('data-tab') || activeTab || '';
      try { if (currentTab) sessionStorage.setItem(PM_ACTIVE_TAB_KEY, currentTab); } catch {}
      tabbar.querySelectorAll('.pm-tab').forEach((item) => {
        const isActive = item.getAttribute('data-tab') === tab.id;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-selected', String(isActive));
      });
      _positionTabIndicator(tabbar, tab.id, { animate: true });
      if (typeof onNavigate === 'function') window.setTimeout(() => onNavigate(tab.route), 90);
    });
    tabbar.appendChild(b);
  });
  app.appendChild(tabbar);
  _rememberActiveTab(activeTab);
  // Snap the pill onto the active tab once laid out; animate from the previous
  // tab if we just navigated here from another tab.
  window.requestAnimationFrame(() => {
    if (shouldAnimateTab) {
      // Park the pill on the previous tab, then glide to the active one.
      _positionTabIndicator(tabbar, previousTab, { animate: false });
      window.requestAnimationFrame(() => _positionTabIndicator(tabbar, activeTab, { animate: true }));
    } else {
      _positionTabIndicator(tabbar, activeTab, { animate: false });
    }
  });
  if (!_tabResizeHandlerBound) {
    _tabResizeHandlerBound = true;
    window.addEventListener('resize', () => {
      const bar = document.querySelector('.pm-tabbar');
      const active = bar?.querySelector('.pm-tab.active')?.getAttribute('data-tab');
      if (bar && active) _positionTabIndicator(bar, active, { animate: false });
    }, { passive: true });
  }

  initMobileCanvasSheet();

  return { app, page, tabbar };
}

async function _renderDrawerSessions({ onOpenSession, loadSessions, searchSessions, onNewChat }) {
  const head = _drawerEl?.querySelector('#pm-drawer-session-head');
  const sessionList = _drawerEl?.querySelector('#pm-mobile-session-list');
  if (!head || !sessionList || typeof loadSessions !== 'function') return;
  if (_drawerSearch) {
    _renderDrawerSearchState({ onOpenSession, loadSessions, searchSessions, onNewChat });
    return;
  }
  try {
    const drawerState = _loadDrawerState();
    let data = await loadSessions({ channel: _currentDrawerSessionChannel(), limit: PM_DRAWER_SESSION_PAGE_SIZE, offset: 0 });
    data = typeof window.enrichMobileSessionGroupsForDrawer === 'function'
      ? await window.enrichMobileSessionGroupsForDrawer(async () => data)
      : data;
    const channels = Array.isArray(data?.channels) ? data.channels : [];
    const selectedChannel = channels.find((c) => c.key === drawerState.channel) || channels[0] || null;

    if (drawerState.view === 'channels') {
      head.innerHTML = `
        <button class="pm-drawer-back" type="button" data-drawer-view="mobile">${ICONS.back}<span>Sessions</span></button>
        <div class="pm-drawer-section-title">Channels</div>
      `;
      sessionList.innerHTML = channels.length
        ? channels.map((c) => _channelButtonHtml(c)).join('')
        : '<div class="pm-session-empty">No channels yet.</div>';
    } else if (drawerState.view === 'channelChats' && selectedChannel) {
      if (!_drawerPageStateFor(selectedChannel.key).initialized) {
        await _loadDrawerSessionPage({ channel: selectedChannel.key, loadSessions });
      }
      const pageState = _drawerPageStateFor(selectedChannel.key);
      const channelLabel = selectedChannel.label || selectedChannel.key;
      head.innerHTML = `
        <button class="pm-drawer-back" type="button" data-drawer-view="channels">${ICONS.back}<span>Channels</span></button>
        <div class="pm-drawer-section-title">${escapeHtml(channelLabel)}</div>
      `;
      sessionList.innerHTML = _sessionPageHtml(pageState, `No ${escapeHtml(channelLabel)} chats yet.`);
      _wireDrawerInfiniteScroll({ channel: selectedChannel.key, loadSessions, onOpenSession, searchSessions, onNewChat });
    } else {
      if (!_drawerPageStateFor('mobile').initialized) {
        await _loadDrawerSessionPage({ channel: 'mobile', loadSessions });
      }
      const pageState = _drawerPageStateFor('mobile');
      head.innerHTML = `
        <div class="pm-drawer-section-title">Sessions</div>
        <button class="pm-session-row pm-channel-entry" type="button" data-drawer-view="channels">
          <span class="pm-icon pm-channel-entry-icon">${ICONS.layers || ICONS.chat}</span>
          <span class="pm-flex">Channels</span>
          <span class="pm-chev">${ICONS.chev}</span>
        </button>
      `;
      sessionList.innerHTML = _sessionPageHtml(pageState, 'No mobile chats yet.');
      _wireDrawerInfiniteScroll({ channel: 'mobile', loadSessions, onOpenSession, searchSessions, onNewChat });
    }

    _wireDrawerSessionControls({ onOpenSession, loadSessions, searchSessions, onNewChat });
  } catch {
    if (head) head.innerHTML = '<div class="pm-drawer-section-title">Sessions</div>';
    sessionList.innerHTML = '<div class="pm-session-empty">Could not load sessions.</div>';
  }
}

function _sessionPageHtml(pageState, emptyText) {
  const sessions = Array.isArray(pageState?.sessions) ? pageState.sessions : [];
  if (!sessions.length && pageState?.loading) return '<div class="pm-session-empty">Loading...</div>';
  if (!sessions.length && pageState?.error) return '<div class="pm-session-empty">Could not load sessions.</div>';
  if (!sessions.length) return `<div class="pm-session-empty">${emptyText}</div>`;
  return [
    sessions.map((s) => _sessionButtonHtml(s)).join(''),
    pageState?.error ? '<div class="pm-session-empty">Could not load more chats.</div>' : '',
    pageState?.hasMore ? '<button class="pm-session-load-more" type="button" data-session-load-more>Load more chats</button>' : '',
    pageState?.loading ? '<div class="pm-session-empty pm-session-loading">Loading more...</div>' : '',
  ].filter(Boolean).join('');
}

function _wireDrawerSessionControls({ onOpenSession, loadSessions, searchSessions, onNewChat }) {
  _drawerEl.querySelectorAll('[data-drawer-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-drawer-view') || 'mobile';
      _saveDrawerState({ view, channel: view === 'channelChats' ? _loadDrawerState().channel : '' });
      _renderDrawerSessions({ onOpenSession, loadSessions, searchSessions, onNewChat });
    });
  });
  _drawerEl.querySelectorAll('[data-channel-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _saveDrawerState({ view: 'channelChats', channel: btn.getAttribute('data-channel-key') || '' });
      _renderDrawerSessions({ onOpenSession, loadSessions, searchSessions, onNewChat });
    });
  });
  _drawerEl.querySelector('[data-session-load-more]')?.addEventListener('click', () => _loadNextDrawerSessionPage({ loadSessions, onOpenSession, searchSessions, onNewChat }));
  _drawerEl.querySelector('[data-mobile-new-chat]')?.addEventListener('click', () => {
    closeDrawer();
    Promise.resolve(typeof onNewChat === 'function' ? onNewChat() : null)
      .then(() => {
        _saveDrawerState({ view: 'mobile', channel: '' });
        _resetDrawerPageState('mobile');
      })
      .catch(() => {});
  });
  _drawerEl.querySelectorAll('[data-session-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sessionId = btn.getAttribute('data-session-id');
      closeDrawer();
      if (typeof onOpenSession === 'function') onOpenSession(sessionId);
    });
  });
}

async function _loadNextDrawerSessionPage({ loadSessions, onOpenSession, searchSessions, onNewChat } = {}) {
  const channel = _currentDrawerSessionChannel();
  const pageState = _drawerPageStateFor(channel);
  if (pageState.loading || !pageState.hasMore) return;
  _renderVisibleDrawerSessionPage(channel);
  await _loadDrawerSessionPage({ channel, loadSessions });
  _renderVisibleDrawerSessionPage(channel);
  _wireDrawerSessionControls({ onOpenSession, loadSessions, searchSessions, onNewChat });
}

function _renderVisibleDrawerSessionPage(channel) {
  const sessionList = _drawerEl?.querySelector('#pm-mobile-session-list');
  if (!sessionList) return;
  const pageState = _drawerPageStateFor(channel);
  const label = channel === 'mobile' ? 'mobile' : channel;
  sessionList.innerHTML = _sessionPageHtml(pageState, channel === 'mobile' ? 'No mobile chats yet.' : `No ${escapeHtml(label)} chats yet.`);
}

function _wireDrawerInfiniteScroll({ channel, loadSessions, onOpenSession, searchSessions, onNewChat }) {
  if (!_drawerEl) return;
  _drawerEl.onscroll = () => {
    if (_drawerSearch) return;
    if (_currentDrawerSessionChannel() !== channel) return;
    const nearBottom = _drawerEl.scrollTop + _drawerEl.clientHeight >= _drawerEl.scrollHeight - 96;
    if (nearBottom) _loadNextDrawerSessionPage({ loadSessions, onOpenSession, searchSessions, onNewChat });
  };
}

function _renderDrawerSearchState({ onOpenSession, loadSessions, searchSessions, onNewChat }) {
  const nav = _drawerEl?.querySelector('.pm-drawer-list');
  const sessions = _drawerEl?.querySelector('#pm-drawer-sessions');
  const results = _drawerEl?.querySelector('#pm-drawer-search-results');
  const list = _drawerEl?.querySelector('#pm-mobile-search-list');
  const query = _drawerSearch;
  if (!nav || !sessions || !results || !list) return;

  if (!query) {
    nav.hidden = false;
    sessions.hidden = false;
    results.hidden = true;
    list.innerHTML = '';
    _renderDrawerSessions({ onOpenSession, loadSessions, searchSessions, onNewChat });
    return;
  }

  if (_drawerEl) _drawerEl.onscroll = null;

  nav.hidden = true;
  sessions.hidden = true;
  results.hidden = false;
  list.innerHTML = '<div class="pm-session-empty">Searching full chat history...</div>';

  if (_drawerSearchTimer) clearTimeout(_drawerSearchTimer);
  const seq = ++_drawerSearchSeq;
  _drawerSearchTimer = setTimeout(async () => {
    let matches = [];
    let failed = false;
    try {
      if (typeof searchSessions === 'function') matches = await searchSessions(query, { limit: 100 });
    } catch {
      failed = true;
      matches = [];
    }
    if (seq !== _drawerSearchSeq || query !== _drawerSearch) return;
    matches = (Array.isArray(matches) ? matches : []).filter((session) => !_isDrawerSideChatSession(session));
    if (!matches.length) matches = await _localSessionSearchFallback(loadSessions, query);
    if (seq !== _drawerSearchSeq || query !== _drawerSearch) return;

    if (!matches.length) {
      list.innerHTML = failed
        ? '<div class="pm-session-empty">Search is unavailable right now.</div>'
        : `<div class="pm-session-empty">No chats match "${escapeHtml(query)}".</div>`;
      return;
    }

    list.innerHTML = matches.map((s) => _searchResultButtonHtml(s, query)).join('');
    list.querySelectorAll('[data-session-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sessionId = btn.getAttribute('data-session-id');
        closeDrawer();
        if (typeof onOpenSession === 'function') onOpenSession(sessionId);
      });
    });
  }, 180);
}

async function _localSessionSearchFallback(loadSessions, query) {
  if (typeof loadSessions !== 'function') return [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const data = await loadSessions().catch(() => null);
  const all = [
    ...(Array.isArray(data?.mobile) ? data.mobile : []),
    ...(Array.isArray(data?.channels) ? data.channels.flatMap(c => Array.isArray(c.sessions) ? c.sessions : []) : []),
  ];
  return all.filter((s) => !_isDrawerSideChatSession(s)).filter((s) => {
    const title = String(s?.title || '').toLowerCase();
    const preview = String(s?.preview || '').toLowerCase();
    return title.includes(q) || preview.includes(q);
  }).slice(0, 100);
}

function _sessionStateMeta(session) {
  const activeRun = session?.activeRun === true;
  const unread = session?.mobileUnread === true && !activeRun;
  return {
    activeRun,
    unread,
    stateClass: activeRun ? ' is-working' : (unread ? ' is-unread' : ''),
    stateName: activeRun ? 'working' : (unread ? 'unread' : 'idle'),
    stateLabel: activeRun ? '<span class="pm-session-state">Working</span>' : (unread ? '<span class="pm-session-state">Unread</span>' : ''),
  };
}

function _channelButtonHtml(channel) {
  const key = String(channel?.key || '');
  const label = String(channel?.label || key || 'Channel');
  const sessions = Array.isArray(channel?.sessions) ? channel.sessions : [];
  const total = Math.max(sessions.length, Math.floor(Number(channel?.total || 0) || 0));
  const workingCount = sessions.filter((s) => s?.activeRun === true).length;
  const unreadCount = sessions.filter((s) => s?.mobileUnread === true && s?.activeRun !== true).length;
  const channelStateClass = workingCount ? ' is-working' : (unreadCount ? ' is-unread' : '');
  const channelStateLabel = workingCount
    ? `<span class="pm-session-state">${workingCount === 1 ? 'Working' : `${workingCount} working`}</span>`
    : (unreadCount ? `<span class="pm-session-state">${unreadCount === 1 ? 'Unread' : `${unreadCount} unread`}</span>` : '');
  const iconSvg = key === 'web' ? ICONS.monitor : key === 'terminal' ? ICONS.clipboard : ICONS.chat;
  const countLabel = total ? `${total} chat${total === 1 ? '' : 's'}` : 'Open chats';
  return `
    <button class="pm-channel-card${channelStateClass}" type="button" data-channel-key="${escapeHtml(key)}" data-channel-state="${workingCount ? 'working' : (unreadCount ? 'unread' : 'idle')}">
      <span class="pm-channel-icon">${iconSvg}</span>
      <span class="pm-flex"><strong>${escapeHtml(label)}</strong><em>${escapeHtml(countLabel)}</em></span>
      ${channelStateLabel}
      <span class="pm-chev">${ICONS.chev}</span>
    </button>
  `;
}

function _sessionButtonHtml(session) {
  const title = String(session?.title || session?.id || 'New chat');
  const preview = String(session?.preview || '').trim();
  const lastMessageAt = Number(session?.lastMessageAt || session?.lastActiveAt || 0);
  const state = _sessionStateMeta(session);
  return `
    <button class="pm-session-row${state.stateClass}" type="button" data-session-id="${escapeHtml(session.id)}" data-session-state="${state.stateName}">
      <span class="pm-session-row-top"><span class="pm-session-title">${escapeHtml(title)}</span>${state.stateLabel}</span>
      <span class="pm-session-meta-row">
        <span class="pm-session-preview">${escapeHtml(preview || 'No messages yet')}</span>
        <span class="pm-session-time">${escapeHtml(lastMessageAt ? timeAgo(lastMessageAt) : _formatSessionDate(session.createdAt))}</span>
      </span>
    </button>
  `;
}

function _searchResultButtonHtml(session, query) {
  const title = String(session?.title || session?.id || 'New chat');
  const channel = _channelLabel(session?.channel || session?.source || '');
  const role = String(session?.matchedRole || '').toLowerCase();
  const label = role === 'assistant' ? 'Prom' : role === 'user' ? 'You' : 'Match';
  const matched = String(session?.matchedContent || session?.preview || '').trim();
  const snippet = matched ? _highlightSnippet(matched, session?.matchedIndex, query) : escapeHtml(session?.preview || _formatSessionDate(session.lastActiveAt));
  const state = _sessionStateMeta(session);
  return `
    <button class="pm-session-row pm-search-result-row${state.stateClass}" type="button" data-session-id="${escapeHtml(session.id)}" data-session-state="${state.stateName}">
      <span class="pm-session-row-top"><span class="pm-session-title">${escapeHtml(title)}</span>${state.stateLabel}</span>
      <span class="pm-search-meta">${escapeHtml(channel || 'Chat')}${session?.projectName ? ` · ${escapeHtml(session.projectName)}` : ''}</span>
      <span class="pm-session-preview"><strong>${escapeHtml(label)}:</strong> ${snippet}</span>
    </button>
  `;
}

function _channelLabel(channel) {
  const ch = String(channel || '').toLowerCase();
  if (ch === 'web') return 'Computer';
  if (ch === 'mobile') return 'Mobile';
  if (ch === 'telegram') return 'Telegram';
  if (ch === 'discord') return 'Discord';
  if (ch === 'whatsapp') return 'WhatsApp';
  if (ch === 'terminal') return 'CLI';
  return ch ? ch.replace(/[_-]+/g, ' ') : '';
}

function _escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _highlightSnippet(content, matchedIndex, query, maxLen = 132) {
  const raw = String(content || '').replace(/\s+/g, ' ').trim();
  const q = String(query || '').trim();
  if (!raw || !q) return escapeHtml(raw);
  const lower = raw.toLowerCase();
  const idx = Number.isFinite(Number(matchedIndex)) && Number(matchedIndex) >= 0
    ? Number(matchedIndex)
    : lower.indexOf(q.toLowerCase());
  const safe = idx >= 0 ? idx : 0;
  const half = Math.floor(maxLen / 2);
  let start = Math.max(0, safe - half);
  let end = Math.min(raw.length, start + maxLen);
  if (end - start < maxLen) start = Math.max(0, end - maxLen);
  let snippet = raw.slice(start, end).trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < raw.length) snippet += '...';
  const escaped = escapeHtml(snippet);
  return escaped.replace(new RegExp(`(${_escapeRegExp(q)})`, 'ig'), '<mark>$1</mark>');
}

function _searchIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
}

function _formatSessionDate(value) {
  try {
    return new Date(Number(value || Date.now())).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function _escHandler(e) {
  if (e.key === 'Escape') closeDrawer();
}

export function openDrawer() {
  if (!_drawerEl || !_scrimEl) return;
  _drawerEl.classList.add('open');
  _scrimEl.classList.add('open');
}

export function closeDrawer() {
  if (!_drawerEl || !_scrimEl) return;
  _drawerEl.classList.remove('open');
  _scrimEl.classList.remove('open');
  setTimeout(() => document.dispatchEvent(new CustomEvent('pm-drawer-closed')), 0);
}

export function renderMobileHeader({ title, online = true, leftIcon = 'menu', onLeft, onSettings, extras = '', rightActions = '', hideTitle = false, hideBrand = false }) {
  return `
    <header class="pm-header${hideBrand ? ' pm-header-hide-brand' : ''}">
      <button class="pm-icon-btn" data-action="${leftIcon === 'back' ? 'back' : 'menu'}" aria-label="${leftIcon === 'back' ? 'Back' : 'Menu'}">${ICONS[leftIcon]}</button>
      <div class="pm-brand"><span class="pm-brand-flame">🔥</span><span>Prometheus</span></div>
      <div class="pm-header-actions">
        ${online ? `<button type="button" class="pm-online pm-model-badge" aria-live="polite" aria-label="Current model — tap for reasoning, hold to switch model">
          <span class="pm-model-badge-label">${escapeHtml(mobileModelBadgeSeedLabel())}</span>
          <input type="checkbox" switch class="pm-haptic-switch-overlay" aria-hidden="true" tabindex="-1" />
        </button>` : ''}
        ${rightActions}
        <button class="pm-icon-btn" data-action="settings" aria-label="Settings">${ICONS.gear}</button>
      </div>
    </header>
    ${(!hideTitle || (extras && String(extras).trim()))
      ? `<div class="pm-title-row${hideTitle ? ' pm-title-row-compact' : ''}">${hideTitle ? '' : `<h1 class="pm-title">${escapeHtml(title)}</h1>`}${extras}</div>`
      : ''}
  `;
}

/* ---------------- PWA install affordance ---------------- */

function _isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function _isIOS() {
  const ua = window.navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
}

function _renderInstallSlot() {
  const slot = _drawerEl?.querySelector('#pm-install-slot');
  if (!slot) return;
  if (_isStandalone()) { slot.innerHTML = ''; return; }

  const deferred = window.__pmDeferredInstall || null;

  if (deferred) {
    slot.innerHTML = `
      <button class="pm-drawer-item" id="pm-install-btn" style="border-color:var(--pm-orange);background:var(--pm-orange-soft);">
        <span class="pm-icon" style="background:var(--pm-orange);color:#fff;">${ICONS.plus}</span>
        <span class="pm-flex"><strong>Install Prometheus</strong><br><span style="font-size:12px;color:var(--pm-muted);font-weight:500">Add to home screen</span></span>
        <span class="pm-chev">${ICONS.chev}</span>
      </button>
    `;
    slot.querySelector('#pm-install-btn').addEventListener('click', async () => {
      try {
        deferred.prompt();
        const { outcome } = await deferred.userChoice;
        window.__pmDeferredInstall = null;
        if (outcome === 'accepted') _renderInstallSlot();
      } catch (err) {
        console.warn('[pm-pwa] install prompt failed', err);
      }
    });
    return;
  }

  if (_isIOS()) {
    slot.innerHTML = `
      <div class="pm-drawer-item" style="cursor:default;flex-direction:column;align-items:flex-start;gap:6px;">
        <div style="display:flex;align-items:center;gap:10px;width:100%;">
          <span class="pm-icon" style="background:var(--pm-orange);color:#fff;">${ICONS.plus}</span>
          <strong style="flex:1;">Install Prometheus</strong>
        </div>
        <div style="font-size:12px;color:var(--pm-muted);font-weight:500;line-height:1.4;">
          Tap the Share button <span style="font-size:14px;">⎙</span> in Safari, then <strong>Add to Home Screen</strong>.
        </div>
      </div>
    `;
    return;
  }

  slot.innerHTML = '';
}

// Re-render the install slot if beforeinstallprompt arrives after the drawer mounts.
window.addEventListener('pm-install-available', () => _renderInstallSlot());

export function initMobileCanvasSheet() {
  if (window.__pmCanvasSheet) return;

  const sheetEl = document.createElement('div');
  sheetEl.className = 'pm-canvas-sheet';
  sheetEl.id = 'pm-canvas-sheet';
  sheetEl.setAttribute('role', 'dialog');
  sheetEl.setAttribute('aria-modal', 'true');
  sheetEl.setAttribute('aria-label', 'File viewer');
  sheetEl.innerHTML = `
    <div class="pm-canvas-sheet-scrim" id="pm-canvas-scrim"></div>
    <div class="pm-canvas-sheet-panel" id="pm-canvas-panel">
      <div class="pm-canvas-sheet-handle-bar" id="pm-canvas-handle"></div>
      <div class="pm-canvas-sheet-header">
        <div class="pm-canvas-sheet-tabs" id="pm-canvas-tabs"></div>
        <button type="button" class="pm-canvas-sheet-close-btn" id="pm-canvas-close" aria-label="Close">✕</button>
      </div>
      <div class="pm-canvas-sheet-toolbar">
        <span class="pm-canvas-sheet-file-name" id="pm-canvas-file-name"></span>
        <span class="pm-canvas-interaction-toggle" id="pm-canvas-interaction-toggle" style="display:none;" role="group" aria-label="Canvas interaction mode">
          <button type="button" class="pm-canvas-interaction-btn" data-canvas-interaction-mode="interact" aria-pressed="false">Interact</button>
          <button type="button" class="pm-canvas-interaction-btn" data-canvas-interaction-mode="inspect" aria-pressed="false">Inspect</button>
        </span>
        <button type="button" class="pm-canvas-sheet-save-btn" id="pm-canvas-preview" style="display:none;" aria-label="Render preview">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12s1.5-3 4-3 4 3 4 3-1.5 3-4 3-4-3-4-3z"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>
          Preview
        </button>
        <a class="pm-canvas-sheet-save-btn" id="pm-canvas-save" href="#" download target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Save
        </a>
      </div>
      <div class="pm-canvas-sheet-body" id="pm-canvas-body">
        <div class="pm-canvas-sheet-empty">No file open</div>
      </div>
    </div>
  `;
  document.body.appendChild(sheetEl);

  const api = {
    tabs: [],
    activeIdx: -1,

    open(file) {
      const src = String(file.src || '');
      const existing = src ? api.tabs.findIndex(t => t.src === src) : -1;
      if (existing >= 0) {
        api.activeIdx = existing;
      } else {
        api.tabs.push({
          id: `cs${Date.now()}`,
          name: String(file.name || 'File'),
          kind: String(file.kind || 'file'),
          path: String(file.path || ''),
          src,
          download: String(file.download || src),
          interactionMode: normalizeCanvasInteractionMode(file.interactionMode) || defaultCanvasInteractionMode(file),
        });
        api.activeIdx = api.tabs.length - 1;
      }
      api._render();
      sheetEl.classList.add('open');
    },

    close() {
      sheetEl.classList.remove('open');
    },

    switchTab(idx) {
      if (idx < 0 || idx >= api.tabs.length) return;
      api.activeIdx = idx;
      api._render();
    },

    removeTab(idx) {
      api.tabs.splice(idx, 1);
      if (!api.tabs.length) { api.close(); return; }
      api.activeIdx = Math.min(api.activeIdx, api.tabs.length - 1);
      api._render();
    },

    _render() {
      const tabsEl = document.getElementById('pm-canvas-tabs');
      const bodyEl = document.getElementById('pm-canvas-body');
      const fileNameEl = document.getElementById('pm-canvas-file-name');
      const saveEl = document.getElementById('pm-canvas-save');
      const previewBtn = document.getElementById('pm-canvas-preview');
      const interactionToggle = document.getElementById('pm-canvas-interaction-toggle');
      if (!tabsEl || !bodyEl) return;

      const tab = api.tabs[api.activeIdx] || null;
      if (tab && !normalizeCanvasInteractionMode(tab.interactionMode)) {
        tab.interactionMode = defaultCanvasInteractionMode(tab);
      }

      tabsEl.innerHTML = api.tabs.map((t, i) => `
        <button type="button" class="pm-canvas-sheet-tab${i === api.activeIdx ? ' active' : ''}" data-cs-tab="${i}" title="${escapeHtml(t.name)}">
          <span class="pm-canvas-sheet-tab-name">${escapeHtml(t.name)}</span>
          <span class="pm-canvas-sheet-tab-close" data-cs-close="${i}">×</span>
        </button>
      `).join('');

      if (fileNameEl) fileNameEl.textContent = tab?.name || '';
      if (saveEl) {
        saveEl.href = tab?.download || tab?.src || '#';
        saveEl.download = tab?.name || 'file';
      }

      // Show Preview button for file types that benefit from screenshot rendering
      const previewable = tab && tab.path && !['image', 'video', 'audio'].includes(tab.kind);
      if (previewBtn) previewBtn.style.display = previewable ? '' : 'none';
      const iframeBacked = !!(tab && !['image', 'video', 'audio'].includes(tab.kind));
      if (interactionToggle) {
        interactionToggle.style.display = iframeBacked ? 'inline-flex' : 'none';
        interactionToggle.querySelectorAll('[data-canvas-interaction-mode]').forEach((button) => {
          const mode = button.getAttribute('data-canvas-interaction-mode');
          const active = mode === (tab?.interactionMode || 'inspect');
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', String(active));
        });
      }

      if (!tab) {
        bodyEl.innerHTML = '<div class="pm-canvas-sheet-empty">No file open</div>';
        sheetEl.classList.remove('is-interacting', 'is-inspecting');
        resetCanvasZoom(bodyEl);
        return;
      }

      if (tab.kind === 'image') {
        bodyEl.innerHTML = canvasZoomHtml(`<img src="${escapeHtml(tab.src)}" alt="${escapeHtml(tab.name)}">`);
      } else if (tab.kind === 'video') {
        bodyEl.innerHTML = canvasZoomHtml(`<video src="${escapeHtml(tab.src)}" controls playsinline></video>`);
      } else if (tab.kind === 'audio') {
        bodyEl.innerHTML = `<audio src="${escapeHtml(tab.src)}" controls></audio>`;
        sheetEl.classList.remove('is-interacting', 'is-inspecting');
        resetCanvasZoom(bodyEl);
      } else {
        bodyEl.innerHTML = canvasZoomHtml(`<iframe src="${escapeHtml(tab.src)}" title="${escapeHtml(tab.name)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>`);
      }
      applyCanvasInteractionMode(sheetEl, bodyEl, tab);
    },

    setInteractionMode(mode) {
      const tab = api.tabs[api.activeIdx];
      const nextMode = normalizeCanvasInteractionMode(mode);
      if (!tab || !nextMode || ['image', 'video', 'audio'].includes(tab.kind)) return;
      tab.interactionMode = nextMode;
      applyCanvasInteractionMode(sheetEl, document.getElementById('pm-canvas-body'), tab);
      const toggle = document.getElementById('pm-canvas-interaction-toggle');
      toggle?.querySelectorAll?.('[data-canvas-interaction-mode]')?.forEach((button) => {
        const active = button.getAttribute('data-canvas-interaction-mode') === nextMode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    },
  };

  document.getElementById('pm-canvas-tabs').addEventListener('click', (ev) => {
    const closeBtn = ev.target.closest('[data-cs-close]');
    if (closeBtn) { ev.stopPropagation(); api.removeTab(Number(closeBtn.getAttribute('data-cs-close'))); return; }
    const tabBtn = ev.target.closest('[data-cs-tab]');
    if (tabBtn) api.switchTab(Number(tabBtn.getAttribute('data-cs-tab')));
  });
  document.getElementById('pm-canvas-close').addEventListener('click', () => api.close());
  document.getElementById('pm-canvas-scrim').addEventListener('click', () => api.close());
  document.getElementById('pm-canvas-interaction-toggle')?.addEventListener('click', (ev) => {
    const btn = ev.target?.closest?.('[data-canvas-interaction-mode]');
    if (!btn) return;
    api.setInteractionMode(btn.getAttribute('data-canvas-interaction-mode'));
  });

  // Preview button — render a screenshot of the current file via /api/preview/screenshot
  document.getElementById('pm-canvas-preview').addEventListener('click', async () => {
    const tab = api.tabs[api.activeIdx];
    if (!tab?.path) return;
    const bodyEl = document.getElementById('pm-canvas-body');
    const btn = document.getElementById('pm-canvas-preview');
    if (!bodyEl || !btn) return;
    btn.disabled = true;
    btn.textContent = 'Rendering…';
    bodyEl.innerHTML = '<div class="pm-canvas-sheet-empty">Rendering preview…</div>';
    try {
      const r = await fetch(`/api/preview/screenshot?path=${encodeURIComponent(tab.path)}`).then(res => res.json());
      const chunks = Array.isArray(r?.chunks) ? r.chunks : [];
      if (!chunks.length) throw new Error('No preview generated');
      // Show all chunks stacked vertically as images
      bodyEl.innerHTML = canvasZoomHtml(`<div class="pm-canvas-preview-stack">${
        chunks.map(c => `<img src="data:image/png;base64,${c.base64}" style="width:100%;display:block;" alt="Preview">`).join('')
      }</div>`);
      const previewTab = { ...tab, kind: 'image', interactionMode: 'inspect' };
      applyCanvasInteractionMode(sheetEl, bodyEl, previewTab);
    } catch (err) {
      bodyEl.innerHTML = `<div class="pm-canvas-sheet-empty">Preview failed: ${escapeHtml(String(err?.message || err))}</div>`;
      sheetEl.classList.remove('is-interacting', 'is-inspecting');
      resetCanvasZoom(bodyEl);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12s1.5-3 4-3 4 3 4 3-1.5 3-4 3-4-3-4-3z"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg> Preview`;
    }
  });

  // Drag handle to dismiss
  const handle = document.getElementById('pm-canvas-handle');
  const panel = document.getElementById('pm-canvas-panel');
  let _dragY = null;
  handle.addEventListener('touchstart', (e) => { _dragY = e.touches[0].clientY; panel.style.transition = 'none'; }, { passive: true });
  handle.addEventListener('touchmove', (e) => {
    if (_dragY === null) return;
    const dy = e.touches[0].clientY - _dragY;
    if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  handle.addEventListener('touchend', (e) => {
    if (_dragY === null) return;
    const dy = e.changedTouches[0].clientY - _dragY;
    panel.style.transition = '';
    panel.style.transform = '';
    if (dy > 80) api.close();
    _dragY = null;
  });

  // Global delegated handler — intercepts all data-pm-media taps anywhere in the app
  document.body.addEventListener('click', (ev) => {
    const btn = ev.target?.closest?.('[data-pm-media]');
    if (!btn) return;
    ev.preventDefault();
    api.open({
      name: btn.getAttribute('data-name') || 'File',
      kind: btn.getAttribute('data-kind') || 'file',
      path: btn.getAttribute('data-path') || '',
      src:  btn.getAttribute('data-src')  || '',
      download: btn.getAttribute('data-download') || '',
    });
  });

  window.__pmCanvasSheet = api;
}

function normalizeCanvasInteractionMode(mode) {
  const value = String(mode || '').trim().toLowerCase();
  return value === 'interact' || value === 'inspect' ? value : '';
}

function getCanvasFileExt(file = {}) {
  const source = String(file.name || file.path || file.src || '').split(/[?#]/)[0];
  const name = source.split(/[\\/]/).pop() || '';
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

function defaultCanvasInteractionMode(file = {}) {
  const kind = String(file.kind || '').trim().toLowerCase();
  if (kind === 'image' || kind === 'video' || kind === 'audio') return 'inspect';
  const ext = getCanvasFileExt(file);
  return ['html', 'htm', 'js', 'mjs', 'cjs', 'css', 'jsx', 'tsx', 'ts', 'vue', 'svelte'].includes(ext)
    ? 'interact'
    : 'inspect';
}

function applyCanvasInteractionMode(sheetEl, bodyEl, tab = {}) {
  if (!bodyEl) return;
  const mode = normalizeCanvasInteractionMode(tab.interactionMode) || defaultCanvasInteractionMode(tab);
  const iframeBacked = !!bodyEl.querySelector?.('iframe');
  sheetEl?.classList?.toggle('is-interacting', iframeBacked && mode === 'interact');
  sheetEl?.classList?.toggle('is-inspecting', !iframeBacked || mode !== 'interact');
  initCanvasZoom(bodyEl, { enabled: !iframeBacked || mode !== 'interact' });
}

function canvasZoomHtml(innerHtml) {
  return `
    <div class="pm-canvas-zoom-viewport" data-canvas-zoom-viewport>
      <div class="pm-canvas-zoom-content" data-canvas-zoom-content>${innerHtml}</div>
    </div>
  `;
}

function resetCanvasZoom(root) {
  if (!root) return;
  root.__pmCanvasZoomCleanup?.();
  root.__pmCanvasZoomCleanup = null;
}

function initCanvasZoom(root, options = {}) {
  resetCanvasZoom(root);
  const viewport = root?.querySelector?.('[data-canvas-zoom-viewport]');
  const content = root?.querySelector?.('[data-canvas-zoom-content]');
  if (!viewport || !content) return;
  if (options.enabled === false) {
    content.style.transform = 'translate3d(0px, 0px, 0px) scale(1)';
    viewport.classList.remove('is-zoomed');
    return;
  }

  const state = {
    pointers: new Map(),
    scale: 1,
    minScale: 1,
    maxScale: 5,
    x: 0,
    y: 0,
    lastTapAt: 0,
    startScale: 1,
    startDistance: 0,
    startCenter: null,
    startX: 0,
    startY: 0,
  };

  const apply = () => {
    content.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`;
    viewport.classList.toggle('is-zoomed', state.scale > 1.01);
  };

  const clamp = () => {
    state.scale = Math.min(state.maxScale, Math.max(state.minScale, state.scale));
    if (state.scale <= 1.01) {
      state.scale = 1;
      state.x = 0;
      state.y = 0;
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const maxX = Math.max(0, (rect.width * state.scale - rect.width) / 2);
    const maxY = Math.max(0, (rect.height * state.scale - rect.height) / 2);
    state.x = Math.min(maxX, Math.max(-maxX, state.x));
    state.y = Math.min(maxY, Math.max(-maxY, state.y));
  };

  const setScaleAt = (nextScale, clientX, clientY) => {
    const rect = viewport.getBoundingClientRect();
    const prevScale = state.scale || 1;
    const clampedScale = Math.min(state.maxScale, Math.max(state.minScale, nextScale));
    const originX = clientX - rect.left - rect.width / 2 - state.x;
    const originY = clientY - rect.top - rect.height / 2 - state.y;
    state.x -= originX * (clampedScale / prevScale - 1);
    state.y -= originY * (clampedScale / prevScale - 1);
    state.scale = clampedScale;
    clamp();
    apply();
  };

  const pointers = () => Array.from(state.pointers.values());
  const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const center = (a, b) => ({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 });

  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    state.pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    viewport.setPointerCapture?.(event.pointerId);
    const pts = pointers();
    if (pts.length === 1) {
      state.startX = state.x;
      state.startY = state.y;
      state.startCenter = pts[0];
    } else if (pts.length === 2) {
      state.startScale = state.scale;
      state.startDistance = distance(pts[0], pts[1]) || 1;
      state.startCenter = center(pts[0], pts[1]);
      state.startX = state.x;
      state.startY = state.y;
    }
  };

  const onPointerMove = (event) => {
    if (!state.pointers.has(event.pointerId)) return;
    state.pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    const pts = pointers();
    if (pts.length === 1 && state.scale > 1.01 && state.startCenter) {
      event.preventDefault();
      state.x = state.startX + (pts[0].clientX - state.startCenter.clientX);
      state.y = state.startY + (pts[0].clientY - state.startCenter.clientY);
      clamp();
      apply();
    } else if (pts.length >= 2) {
      event.preventDefault();
      const currentDistance = distance(pts[0], pts[1]) || state.startDistance || 1;
      const currentCenter = center(pts[0], pts[1]);
      state.scale = state.startScale * (currentDistance / (state.startDistance || currentDistance));
      state.x = state.startX + (currentCenter.clientX - state.startCenter.clientX);
      state.y = state.startY + (currentCenter.clientY - state.startCenter.clientY);
      clamp();
      apply();
    }
  };

  const onPointerEnd = (event) => {
    state.pointers.delete(event.pointerId);
    const pts = pointers();
    if (pts.length === 1) {
      state.startX = state.x;
      state.startY = state.y;
      state.startCenter = pts[0];
    } else if (!pts.length) {
      clamp();
      apply();
    }
  };

  const onDoubleTap = (event) => {
    const now = Date.now();
    if (now - state.lastTapAt < 280) {
      event.preventDefault();
      if (state.scale > 1.01) {
        state.scale = 1;
        state.x = 0;
        state.y = 0;
        apply();
      } else {
        setScaleAt(2.25, event.clientX, event.clientY);
      }
      state.lastTapAt = 0;
      return;
    }
    state.lastTapAt = now;
  };

  const onWheel = (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setScaleAt(state.scale * (event.deltaY > 0 ? 0.9 : 1.1), event.clientX, event.clientY);
  };
  const onResize = () => {
    clamp();
    apply();
  };

  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerEnd);
  viewport.addEventListener('pointercancel', onPointerEnd);
  viewport.addEventListener('click', onDoubleTap, true);
  viewport.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', onResize);
  apply();

  root.__pmCanvasZoomCleanup = () => {
    viewport.removeEventListener('pointerdown', onPointerDown);
    viewport.removeEventListener('pointermove', onPointerMove);
    viewport.removeEventListener('pointerup', onPointerEnd);
    viewport.removeEventListener('pointercancel', onPointerEnd);
    viewport.removeEventListener('click', onDoubleTap, true);
    viewport.removeEventListener('wheel', onWheel);
    window.removeEventListener('resize', onResize);
  };
}

export function wireHeaderActions(pageEl, { onLeft, onSettings, onBack, onNewChat }) {
  pageEl.querySelectorAll('[data-action]').forEach(btn => {
    const a = btn.getAttribute('data-action');
    btn.addEventListener('click', () => {
      if (a === 'menu') openDrawer();
      else if (a === 'back' && onBack) onBack();
      else if (a === 'settings') {
        // Open the full desktop Settings modal in place (no route change) so
        // closing it returns the user to the page they were on. Falls back to
        // the settings route only if the desktop modal helper is unavailable.
        if (onSettings) onSettings();
        else if (typeof window.pmOpenSettings === 'function') window.pmOpenSettings();
        else if (typeof window.openSettings === 'function') window.openSettings();
        else window.location.hash = '#mobile/settings';
      }
      else if (a === 'new-chat' && onNewChat) onNewChat();
    });
  });
}
