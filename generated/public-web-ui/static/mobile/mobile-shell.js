// Mobile shell — header, drawer, bottom tabbar. Pure DOM helpers.
import { mobileNavTabs, mobileDrawerItems } from './mobile-data.js';
import { renderMd, timeAgo } from '../utils.js';
import { initMobileModelBadge, mobileModelBadgeSeedLabel, attachMobileButtonHaptic, pmHaptic } from './mobile-model-badge.js';
import { mobileGatewayFetch, buildWorkspaceCanvasUrl } from './mobile-api.js';

// ── Pinned sessions (localStorage) ────────────────────────────────────────────
const PM_PINNED_SESSIONS_KEY = 'pm_mobile_pinned_sessions';

function _getPinnedSessionIds() {
  try {
    const raw = localStorage.getItem(PM_PINNED_SESSIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch { return []; }
}

function _savePinnedSessionIds(ids) {
  try { localStorage.setItem(PM_PINNED_SESSIONS_KEY, JSON.stringify(ids)); } catch {}
}

function _isPinned(sessionId) {
  return _getPinnedSessionIds().includes(String(sessionId || ''));
}

function _togglePin(sessionId) {
  const id = String(sessionId || '');
  if (!id) return false;
  const ids = _getPinnedSessionIds();
  const idx = ids.indexOf(id);
  if (idx >= 0) {
    ids.splice(idx, 1);
    _savePinnedSessionIds(ids);
    return false; // unpinned
  } else {
    ids.unshift(id);
    _savePinnedSessionIds(ids);
    return true; // pinned
  }
}

// Small SVG icon set inlined so we don't depend on external icon loaders for this view.
export const ICONS = {
  menu:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="7"  x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="14" y2="17"/></svg>',
  gear:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  bell:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
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
  compose:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>',
  chev:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  fork:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M6 8v2a4 4 0 0 0 4 4h2"/><path d="M18 8v2a4 4 0 0 1-4 4h-2"/><path d="M12 14v2"/></svg>',
  refresh:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.5 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.65 4.36A9 9 0 0 0 20.5 15"/></svg>',
  plus:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  x:         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  play:      '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
  pause:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>',
  trash:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  clock:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
  paperclip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.49"/></svg>',
  send:      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>',
  micSmall:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg>',
  volume:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
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
let _drawerCallbacks = null;
let _drawerRefreshing = false;
let _mobileNoSelectGuardInstalled = false;
const PM_DRAWER_REFRESH_TTL_MS = 30_000;
const PM_NO_SELECT_INTERACTIVE_SELECTOR = [
  'button',
  '[role="button"]',
  '[data-action]',
  '[data-route]',
  '[data-tab]',
  '.pm-tab',
  '.pm-icon-btn',
  '.pm-drawer-item',
  '.pm-drawer-new-chat',
  '.pm-drawer-close',
  '.pm-session-row',
  '.pm-channel-card',
  '.pm-command-action',
  '.pm-command-chip',
  '.pm-mobile-queued-text',
  '.pm-mobile-queued-icon',
  '.pm-scroll-latest',
  '.pm-main-plan-pill',
  '.pm-background-spawn-pill',
  '.pm-background-spawn-close',
  '.pm-background-spawn-summary',
  '.pm-msg-action',
  '.pm-msg-lp-btn',
].join(',');

function _isEditableTarget(target) {
  return !!target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], .pm-composer-input, .pm-mobile-edit-input, .pm-drawer-search input');
}

function _installMobileNoSelectGuard() {
  if (_mobileNoSelectGuardInstalled) return;
  _mobileNoSelectGuardInstalled = true;
  const suppress = (ev) => {
    if (!document.body?.classList?.contains('pm-mobile-active')) return;
    if (_isEditableTarget(ev.target)) return;
    const interactive = ev.target?.closest?.(PM_NO_SELECT_INTERACTIVE_SELECTOR);
    if (!interactive) return;
    ev.preventDefault();
    ev.stopPropagation();
  };
  document.addEventListener('selectstart', suppress, true);
  document.addEventListener('contextmenu', suppress, true);
}
export async function refreshMobileDrawerSessions({ force = false, channel = '' } = {}) {
  if (!_drawerEl || !_drawerCallbacks) return;
  if (_drawerSearch) return;
  if (_drawerRefreshing && !force) return;
  _drawerRefreshing = true;
  try {
    const targetChannel = String(channel || _currentDrawerSessionChannel() || 'mobile').trim() || 'mobile';
    const state = _drawerPageStateFor(targetChannel);
    const freshEnough = state.initialized
      && Number(state.loadedAt || 0) > 0
      && Date.now() - Number(state.loadedAt || 0) < PM_DRAWER_REFRESH_TTL_MS;
    if (!force && freshEnough) return;
    _resetDrawerPageState(targetChannel);
    await _renderDrawerSessions(_drawerCallbacks);
  } catch (err) {
    console.warn('[mobile drawer] refresh failed', err);
  } finally {
    _drawerRefreshing = false;
  }
}

// Drag-down-to-refresh for the drawer session list. Installed PWAs in iOS
// standalone mode have no native pull-to-refresh, so this gives the user a way
// to force-reload sessions by dragging the panel down from the top.
let _pullToRefreshBound = false;
function _wireDrawerPullToRefresh() {
  if (!_drawerEl || _pullToRefreshBound) return;
  _pullToRefreshBound = true;

  // Inject the spinner keyframes once (avoids depending on the CSS bundle).
  if (!document.getElementById('pm-ptr-style')) {
    const st = document.createElement('style');
    st.id = 'pm-ptr-style';
    st.textContent = '@keyframes pm-ptr-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
  }

  const THRESHOLD = 64;   // px of pull needed to trigger a refresh
  const MAX_PULL = 96;    // clamp so the indicator never overshoots
  let startY = 0;
  let pulling = false;
  let armed = false;

  // Lightweight spinner shown above the list while pulling/refreshing.
  const indicator = document.createElement('div');
  indicator.className = 'pm-drawer-ptr';
  indicator.setAttribute('aria-hidden', 'true');
  indicator.style.cssText = [
    'position:absolute', 'top:0', 'left:0', 'right:0',
    'display:flex', 'align-items:center', 'justify-content:center',
    'height:0', 'overflow:hidden', 'pointer-events:none',
    'opacity:0', 'transition:opacity .15s ease', 'z-index:5',
  ].join(';');
  indicator.innerHTML = '<span class="pm-drawer-ptr-spinner" style="width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,.25);border-top-color:var(--pm-orange,#ea6a1f);display:inline-block"></span>';
  try { _drawerEl.appendChild(indicator); } catch {}

  const setPull = (dist) => {
    const d = Math.max(0, Math.min(MAX_PULL, dist));
    indicator.style.height = `${d}px`;
    indicator.style.opacity = d > 4 ? '1' : '0';
    const spin = indicator.firstElementChild;
    if (spin) spin.style.transform = `rotate(${d * 4}deg)`;
  };

  const reset = () => {
    pulling = false;
    armed = false;
    indicator.style.transition = 'height .2s ease, opacity .15s ease';
    setPull(0);
    setTimeout(() => { indicator.style.transition = 'opacity .15s ease'; }, 200);
  };

  const spin = (on) => {
    const el = indicator.firstElementChild;
    if (el) el.style.animation = on ? 'pm-ptr-spin .7s linear infinite' : '';
  };

  _drawerEl.addEventListener('touchstart', (e) => {
    if (_drawerSearch) return;
    if (_drawerEl.scrollTop > 0) return;
    startY = e.touches?.[0]?.clientY || 0;
    pulling = true;
    armed = false;
  }, { passive: true });

  _drawerEl.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    if (_drawerEl.scrollTop > 0) { setPull(0); return; }
    const y = e.touches?.[0]?.clientY || 0;
    const dist = y - startY;
    if (dist <= 0) { setPull(0); return; }
    indicator.style.transition = 'opacity .15s ease';
    setPull(dist * 0.5);
    armed = dist * 0.5 >= THRESHOLD;
  }, { passive: true });

  _drawerEl.addEventListener('touchend', () => {
    if (!pulling) return;
    if (armed) {
      setPull(THRESHOLD);
      spin(true);
      Promise.resolve(refreshMobileDrawerSessions({ force: true }))
        .catch(() => {})
        .finally(() => { spin(false); reset(); });
    } else {
      reset();
    }
  }, { passive: true });
}

const PM_DRAWER_STATE_KEY = 'pm_mobile_drawer_sessions_view';
const PM_THEME_KEY = 'prometheus_theme';
const PM_ACTIVE_TAB_KEY = 'pm_mobile_active_tab';
const PM_DRAWER_SESSION_PAGE_SIZE = 20;
const _drawerSessionPaging = {
  mobile: { sessions: [], total: 0, offset: 0, hasMore: false, loading: false, initialized: false },
  channels: {},
};

function _newDrawerPageState() {
  return { sessions: [], total: 0, offset: 0, hasMore: false, loading: false, initialized: false, pending: null, loadedAt: 0 };
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
  if (_drawerEl?.classList?.contains('open')) {
    refreshMobileDrawerSessions({ force: true, channel: channel || _currentDrawerSessionChannel() }).catch(() => {});
  }
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
      state.loadedAt = Date.now();
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


function _getThemeList() {
  return (window.PROM_THEMES && window.PROM_THEMES.length)
    ? window.PROM_THEMES
    : [
      { id: 'dark', label: 'Default Dark', base: 'dark' },
      { id: 'light', label: 'Light', base: 'light' },
    ];
}

function _resolveTheme(themeId) {
  const themes = _getThemeList();
  const byId = themes.find((t) => t.id === String(themeId || ''));
  if (byId) return byId;

  const direct = String(themeId || '').trim().toLowerCase();
  if (direct === 'dark' || direct === 'light') {
    const byBase = themes.find((t) => t.base === direct);
    if (byBase) return byBase;
  }

  return themes[0] || { id: 'dark', label: 'Default Dark', base: 'dark' };
}

function _getTheme() {
  const currentSkin = document.documentElement.getAttribute('data-skin');
  const list = _getThemeList();
  if (list.some((t) => t.id === currentSkin)) return currentSkin;

  const currentTheme = document.documentElement.getAttribute('data-theme');
  if (currentTheme === 'dark' || currentTheme === 'light') {
    const byBase = _resolveTheme(currentTheme);
    if (byBase) return byBase.id;
  }

  try {
    const saved = localStorage.getItem(PM_THEME_KEY);
    if (saved) {
      const resolved = _resolveTheme(saved);
      if (list.some((t) => t.id === resolved.id)) return resolved.id;
    }
  } catch {}

  return list[0]?.id || 'dark';
}

function _applyMobileTheme(themeId) {
  const theme = _resolveTheme(themeId);
  const resolved = theme.base === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.setAttribute('data-skin', theme.id);
  try { localStorage.setItem(PM_THEME_KEY, theme.id); } catch {}

  // Safari paints its translucent top chrome from the document/theme color,
  // not from the nested .pm-app background. Keep that native-composited area
  // synchronized with the active mobile skin.
  try {
    const mobileBg = getComputedStyle(document.documentElement).getPropertyValue('--pm-bg').trim();
    if (mobileBg) {
      document.documentElement.style.backgroundColor = mobileBg;
      document.body.style.backgroundColor = mobileBg;
      const themeMeta = document.querySelector('meta[name="theme-color"]');
      themeMeta?.setAttribute('content', mobileBg);
    }
  } catch {}

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
    mobileToggle.setAttribute('aria-pressed-label', isDark ? 'Current theme: dark' : 'Current theme: light');
    mobileToggle.setAttribute('data-theme-id', theme.id);
  }

  try {
    document.dispatchEvent(new CustomEvent('prom-theme-change', { detail: { id: theme.id, base: resolved } }));
  } catch {}
}

function _toggleMobileTheme() {
  const themes = _getThemeList();
  if (!themes.length) {
    _applyMobileTheme('dark');
    return;
  }

  const currentThemeId = _getTheme();
  const currentIndex = themes.findIndex((t) => t.id === currentThemeId);
  const nextTheme = themes[(currentIndex + 1) % themes.length] || themes[0];
  _applyMobileTheme(nextTheme?.id || 'dark');
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

// ---- Tab-bar magnifying loupe (CSS clip-mask, WebKit-reliable) -------------
// The lens is a pure-CSS effect now: a scaled clone of the icon row clipped to a
// feathered circle that follows --pm-lens-x (see .pm-tab-magnify in mobile.css).
// CSS moves the mask, so there is ZERO per-frame JS during a drag — that keeps
// the slider free and smooth (the old feImage/feDisplacementMap approach didn't
// magnify in iOS WebKit and re-encoding its data-URI every pointermove is what
// made the slider lag and feel like it was locking onto tabs).


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
    // Glue the magnify lens center to the resting pill center.
    const center = left + width / 2;
    tabbar.style.setProperty('--pm-lens-x', `${center}px`);
    const barW = tabbar.offsetWidth;
    tabbar.style.setProperty('--pm-pill-left', `${left}px`);
    tabbar.style.setProperty('--pm-pill-right', `${Math.max(0, barW - (left + width))}px`);
    tabbar.style.setProperty('--pm-pill-span', `${width}px`);
    tabbar.style.setProperty('--pm-lens-r', `${width / 2}px`);
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

// Make the bottom tabbar behave like a slider: the glass pill can be tapped
// (jumps + slides to that tab) or pressed and dragged across the bar, snapping
// to whichever tab you release over. Navigation fires once, on release.
function _wireTabbarSlider(tabbar, { onNavigate, getActiveTab }) {
  let pointerId = null;
  let startX = 0;
  let lastX = 0;
  let velocity = 0;            // px between the last two pointermove samples
  let dragging = false;
  let pendingTab = null;       // currently highlighted tab during the gesture
  // While pressed/dragging the pill swells past the bar so it reads as a lens
  // lifting off the surface (and the icon underneath magnifies via CSS).
  const PRESS_GROW = 1.18;

  const tabs = () => Array.from(tabbar.querySelectorAll('.pm-tab'));
  const indicator = () => tabbar.querySelector('.pm-tab-indicator');

  // Nearest tab to a clientX, by horizontal centre distance.
  const tabAtX = (clientX) => {
    const rect = tabbar.getBoundingClientRect();
    const x = clientX - rect.left;
    let best = null;
    let bestDist = Infinity;
    for (const t of tabs()) {
      const centre = t.offsetLeft + t.offsetWidth / 2;
      const d = Math.abs(centre - x);
      if (d < bestDist) { bestDist = d; best = t; }
    }
    return best;
  };

  const setActive = (tabEl) => {
    tabs().forEach((item) => {
      const on = item === tabEl;
      item.classList.toggle('active', on);
      item.setAttribute('aria-selected', String(on));
    });
  };

  // 1:1 follow with a velocity-driven elastic stretch: the pill leans and
  // stretches in the direction of travel like a blob of liquid being pulled.
  const followDrag = (clientX) => {
    const ind = indicator();
    const tabEl = pendingTab || tabs()[0];
    if (!ind || !tabEl) return;
    const rect = tabbar.getBoundingClientRect();
    const width = tabEl.offsetWidth;
    const first = tabs()[0];
    const last = tabs()[tabs().length - 1];
    const minLeft = first ? first.offsetLeft : 0;
    const maxLeft = last ? last.offsetLeft : 0;
    let left = (clientX - rect.left) - width / 2;
    left = Math.max(minLeft, Math.min(maxLeft, left));
    ind.style.setProperty('--pm-ind-x', `${left}px`);
    ind.style.setProperty('--pm-ind-w', `${width}px`);
    // Track the lens center to the live pill center so the magnify follows
    // the finger 1:1 across the bar (half-over-icon = half-magnified).
    const pillCenterX = left + width / 2;
    tabbar.style.setProperty('--pm-lens-x', `${pillCenterX}px`);
    // Elastic stretch and lean — same as before.
    const stretch = 1 + Math.min(Math.abs(velocity) * 0.024, 0.42);
    const lean = Math.max(-22, Math.min(22, velocity * 0.9));
    // Expose pill left/right edges in tabbar-space so the CSS clip-path
    // inset() can match the pill rectangle exactly on BOTH sides — a circle
    // radius was asymmetric (bled early on the leading edge).
    const visualHalfW = (width * stretch) / 2;
    const barW = tabbar.offsetWidth;
    const pillLeft  = pillCenterX - visualHalfW;
    const pillRight = barW - (pillCenterX + visualHalfW);
    const pillSpan  = visualHalfW * 2;  // visual width of pill
    tabbar.style.setProperty('--pm-pill-left',  `${pillLeft}px`);
    tabbar.style.setProperty('--pm-pill-right', `${pillRight}px`);
    tabbar.style.setProperty('--pm-pill-span',  `${pillSpan}px`);
    // Keep legacy --pm-lens-r for any other consumers.
    tabbar.style.setProperty('--pm-lens-r', `${visualHalfW}px`);
    ind.style.transform = `translateX(${lean}px) scaleX(${stretch}) scaleY(${PRESS_GROW})`;

  };

  // Spring the pill onto a tab and let the elastic stretch relax to rest.
  const settle = (tabEl) => {
    const ind = indicator();
    if (!ind || !tabEl) return;
    ind.style.setProperty('--pm-ind-x', `${tabEl.offsetLeft}px`);
    const ctr = tabEl.offsetLeft + tabEl.offsetWidth / 2;
    tabbar.style.setProperty('--pm-lens-x', `${ctr}px`);
    // Reset pill bounds to resting (un-stretched) so inverse mask clears correctly.
    const hw = tabEl.offsetWidth / 2;
    const barW = tabbar.offsetWidth;
    tabbar.style.setProperty('--pm-pill-left',  `${ctr - hw}px`);
    tabbar.style.setProperty('--pm-pill-right', `${barW - (ctr + hw)}px`);
    tabbar.style.setProperty('--pm-pill-span',  `${hw * 2}px`);
    ind.style.transform = '';     // relax to identity via the CSS spring transition
  };

  const finish = (e) => {
    if (pointerId === null || (e && e.pointerId !== undefined && e.pointerId !== pointerId)) return;
    try { tabbar.releasePointerCapture(pointerId); } catch {}
    tabbar.classList.remove('pm-tabbar-dragging');
    tabbar.classList.remove('pm-tabbar-pressing');
    const wasDragging = dragging;
    pointerId = null;
    dragging = false;
    velocity = 0;
    const target = wasDragging ? pendingTab : (e ? tabAtX(e.clientX) : pendingTab);
    if (!target) return;
    const id = target.getAttribute('data-tab');
    const tabObj = mobileNavTabs.find((x) => x.id === id);
    const currentId = tabbar.querySelector('.pm-tab.active')?.getAttribute('data-tab')
      || (getActiveTab ? getActiveTab() : '') || '';
    // Remember the tab we're leaving so the post-navigation re-render glides the
    // pill *from* it rather than snapping.
    try { if (currentId) sessionStorage.setItem(PM_ACTIVE_TAB_KEY, currentId); } catch {}
    setActive(target);
    settle(target);
    if (id !== currentId && tabObj && typeof onNavigate === 'function') {
      window.setTimeout(() => onNavigate(tabObj.route), 90);
    }
  };

  tabbar.addEventListener('pointerdown', (e) => {
    const t = e.target?.closest?.('.pm-tab');
    if (!t || !tabbar.contains(t)) return;
    pointerId = e.pointerId;
    startX = lastX = e.clientX;
    velocity = 0;
    dragging = false;
    pendingTab = t;
    // Swell the pill immediately on press (before any drag) so a press-and-hold
    // already magnifies, then the swell tracks through the drag.
    tabbar.classList.add('pm-tabbar-pressing');
    const ind = indicator();
    if (ind) ind.style.transform = `scaleY(${PRESS_GROW})`;
    // Set pill bounds immediately on press so the inverse mask hides the icon
    // right away (before any drag starts).
    const pillEl = indicator();
    if (pillEl) {
      const pl = parseFloat(pillEl.style.getPropertyValue('--pm-ind-x') || t.offsetLeft);
      const pw = parseFloat(pillEl.style.getPropertyValue('--pm-ind-w') || t.offsetWidth);
      const barW2 = tabbar.offsetWidth;
      tabbar.style.setProperty('--pm-pill-left',  `${pl}px`);
      tabbar.style.setProperty('--pm-pill-right', `${barW2 - (pl + pw)}px`);
      tabbar.style.setProperty('--pm-pill-span',  `${pw}px`);
    }
  });

  tabbar.addEventListener('pointermove', (e) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    velocity = e.clientX - lastX;
    lastX = e.clientX;
    if (!dragging) {
      if (Math.abs(e.clientX - startX) < 6) return;   // tap, not a drag (yet)
      dragging = true;
      tabbar.classList.add('pm-tabbar-dragging');
      try { tabbar.setPointerCapture(pointerId); } catch {}
    }
    e.preventDefault();
    const nearest = tabAtX(e.clientX);
    if (nearest && nearest !== pendingTab) {
      pendingTab = nearest;
      setActive(nearest);
      // Buzz on every tab the pill slides over (not just the page we started on).
      // On iOS the global pmHaptic switch toggle is programmatic and does NOT
      // emit a system haptic, so sliding over a tab you never physically pressed
      // felt dead. Each .pm-tab carries its own native <input switch> overlay —
      // clicking *that specific* switch is what actually fires an iOS haptic.
      // Toggle the entered tab's own switch so every tab crossed buzzes, then
      // keep pmHaptic for Android's navigator.vibrate.
      try {
        const sw = nearest.querySelector('.pm-haptic-switch-overlay');
        if (sw) sw.click();
      } catch {}
      pmHaptic(8);
    }
    followDrag(e.clientX);
  });

  tabbar.addEventListener('pointerup', finish);
  tabbar.addEventListener('pointercancel', finish);
}

// Inject the SVG filter the glass layers reference (#pm-liquid-glint). It lives
// in the document once; building it via a detached <div> lets the HTML parser
// namespace the SVG/filter children correctly (setting innerHTML on an <svg>
// element directly does not). Element filters like this DO render in WebKit,
// unlike SVG filters routed through backdrop-filter.
function _ensureLiquidGlassFilters() {
  if (document.getElementById('pm-liquid-glass-defs')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <svg id="pm-liquid-glass-defs" aria-hidden="true" width="0" height="0"
         style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;">
      <defs>
        <filter id="pm-liquid-glint" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.009" numOctaves="2" seed="5" result="n" />
          <feGaussianBlur in="n" stdDeviation="0.6" result="nb" />
          <feDisplacementMap in="SourceGraphic" in2="nb" scale="10" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>`;
  const svg = wrap.firstElementChild;
  if (svg) document.body.appendChild(svg);
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

  _ensureLiquidGlassFilters();
  _installMobileNoSelectGuard();

  const app = el(`<div class="pm-app" id="pm-app"></div>`);
  root.appendChild(app);

  // Drawer lives behind the app panel; opening the menu slides the app right.
  _scrimEl = el(`<div class="pm-drawer-scrim" aria-hidden="true"></div>`);
  _drawerEl = el(`
    <aside class="pm-drawer" role="dialog" aria-label="Menu" aria-modal="true">
      <div class="pm-drawer-brand"><span class="pm-brand-flame">🔥</span><span>Prometheus</span></div>
      <button class="pm-theme-toggle" type="button" data-mobile-theme-toggle aria-label="Toggle dark mode"></button>
      <button class="pm-drawer-close" type="button" data-mobile-drawer-close aria-label="Close menu">${ICONS.x}</button>
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
        <div class="pm-drawer-pinned-list" id="pm-drawer-pinned-list"></div>
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
  root.insertBefore(_drawerEl, app);
  root.insertBefore(_scrimEl, app);

  // Shell-level delegated fallback for the hamburger. Per-page code also wires
  // this via wireHeaderActions(), but if a page's render throws before that
  // call, the menu would otherwise stop opening — this guarantees it always
  // works. openDrawer() is idempotent, so the double-wiring is harmless.
  app.addEventListener('click', (ev) => {
    const menuBtn = ev.target?.closest?.('[data-action="menu"]');
    if (menuBtn && app.contains(menuBtn)) {
      openDrawer();
      return;
    }
    if (document.body.classList.contains('pm-mobile-drawer-open')) {
      ev.preventDefault();
      ev.stopPropagation();
      closeDrawer();
    }
  }, true);

  _scrimEl.addEventListener('click', closeDrawer);
  _drawerEl.querySelectorAll('.pm-drawer-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const route = btn.getAttribute('data-route');
      closeDrawer();
      if (typeof onNavigate === 'function') onNavigate(route);
    });
  });
  const _drawerNewChatBtn = _drawerEl.querySelector('[data-mobile-new-chat]');
  // Haptic feedback on the drawer's New Chat button
  if (_drawerNewChatBtn) {
    try { attachMobileButtonHaptic(_drawerNewChatBtn, () => _drawerNewChatBtn.click()); } catch {}
  }
  _drawerNewChatBtn?.addEventListener('click', () => {
    closeDrawer();
    Promise.resolve(typeof onNewChat === 'function' ? onNewChat() : null)
      .then(() => {
        _saveDrawerState({ view: 'mobile', channel: '' });
        _resetDrawerPageState('mobile');
      })
      .catch(() => {});
  });

  _drawerEl.querySelector('[data-mobile-theme-toggle]')?.addEventListener('click', _toggleMobileTheme);
  _drawerEl.querySelector('[data-mobile-drawer-close]')?.addEventListener('click', closeDrawer);
  _drawerEl.querySelector('#pm-drawer-search-input')?.addEventListener('input', (ev) => {
    _drawerSearch = String(ev.target?.value || '').trim();
    _renderDrawerSearchState({ onOpenSession, loadSessions, searchSessions, onNewChat });
  });
  _applyMobileTheme(_getTheme());
  // Capture live callbacks so refreshMobileDrawerSessions() and pull-to-refresh
  // can re-render the session list later (e.g. when the drawer is reopened after
  // a new chat was created). Without this, refreshMobileDrawerSessions() early-returns.
  _drawerCallbacks = { onOpenSession, loadSessions, searchSessions, onNewChat };
  _renderDrawerSessions({ onOpenSession, loadSessions, searchSessions, onNewChat });
  _wireDrawerPullToRefresh();

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
      <span class="pm-glass-lens" aria-hidden="true"></span>
      <span class="pm-glass-border" aria-hidden="true"></span>
      <span class="pm-tab-indicator" aria-hidden="true"></span>
    </nav>
  `);
  mobileNavTabs.forEach((tab, i) => {
    const b = el(`
      <button class="pm-tab ${tab.id === activeTab ? 'active' : ''}" data-tab="${tab.id}" role="tab" aria-label="${escapeHtml(tab.label)}" aria-selected="${tab.id === activeTab ? 'true' : 'false'}">
        ${ICONS[tab.icon] || ''}
        <span>${escapeHtml(tab.label)}</span>
        <input type="checkbox" switch class="pm-haptic-switch-overlay" aria-hidden="true" tabindex="-1" />
      </button>
    `);
    tabbar.appendChild(b);
    // Set the tab's left-offset custom prop once it's laid out so the inverse
    // mask circle (which is in tabbar coords) can be shifted into each tab's
    // own coordinate space. We do this after first paint.
    window.requestAnimationFrame(() => {
      b.style.setProperty('--pm-tab-left-px', `${b.offsetLeft}px`);
    });
  });
  // True magnifying-lens layer (iOS liquid glass): an icon-only clone of the 4
  // tabs, scaled up and stacked exactly over the real row, then clipped to a
  // feathered circle that follows the pill (--pm-lens-x). Only the icon pixels
  // physically under the glass enlarge, so a half-covered icon is only half
  // magnified — instead of the old binary whole-icon scale.
  const magnify = el(`<div class="pm-tab-magnify" aria-hidden="true"></div>`);
  mobileNavTabs.forEach(tab => {
    const cell = el(`<div class="pm-tab-magnify-cell">${ICONS[tab.icon] || ''}<span class="pm-tab-magnify-label">${escapeHtml(tab.label)}</span></div>`);
    magnify.appendChild(cell);
  });
  tabbar.appendChild(magnify);
  // The loupe magnify + feathered clip is pure CSS driven by --pm-lens-x; no JS
  // filter setup needed (see .pm-tab-magnify in mobile.css).
  // Tap OR drag the glass pill across the bar to switch pages. Tapping lands on
  // the native switch overlay (iOS haptic) and navigates on release; dragging
  // lets the pill track the finger and snaps to the tab you let go over.
  _wireTabbarSlider(tabbar, { onNavigate, getActiveTab: () => activeTab });
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
      // Refresh per-tab left-offset custom props so the inverse lens mask stays aligned.
      if (bar) {
        bar.querySelectorAll('.pm-tab').forEach(t => {
          t.style.setProperty('--pm-tab-left-px', `${t.offsetLeft}px`);
        });
      }
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
    if (drawerState.view === 'mobile') {
      const cachedMobilePage = _drawerPageStateFor('mobile');
      if (cachedMobilePage.initialized) {
        head.innerHTML = `
          <div class="pm-drawer-section-title">Sessions</div>
          <button class="pm-session-row pm-channel-entry" type="button" data-drawer-view="channels">
            <span class="pm-icon pm-channel-entry-icon">${ICONS.layers || ICONS.chat}</span>
            <span class="pm-flex">Channels</span>
            <span class="pm-chev">${ICONS.chev}</span>
          </button>
        `;
        sessionList.innerHTML = _sessionPageHtml(cachedMobilePage, 'No mobile chats yet.');
        _renderDrawerPinnedSessions(cachedMobilePage);
        _wireDrawerInfiniteScroll({ channel: 'mobile', loadSessions, onOpenSession, searchSessions, onNewChat });
        _wireDrawerSessionControls({ onOpenSession, loadSessions, searchSessions, onNewChat });
        return;
      }
      await _loadDrawerSessionPage({ channel: 'mobile', loadSessions });
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
      _renderDrawerPinnedSessions(pageState);
      _wireDrawerInfiniteScroll({ channel: 'mobile', loadSessions, onOpenSession, searchSessions, onNewChat });
      _wireDrawerSessionControls({ onOpenSession, loadSessions, searchSessions, onNewChat });
      return;
    }
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
      _renderDrawerPinnedSessions(pageState);
      _wireDrawerInfiniteScroll({ channel: 'mobile', loadSessions, onOpenSession, searchSessions, onNewChat });
    }

    _wireDrawerSessionControls({ onOpenSession, loadSessions, searchSessions, onNewChat });
  } catch {
    if (head) head.innerHTML = '<div class="pm-drawer-section-title">Sessions</div>';
    sessionList.innerHTML = '<div class="pm-session-empty">Could not load sessions.</div>';
  }
}

function _activeDrawerSessionId() {
  const normalize = (value) => {
    const sid = String(value || '').trim();
    return sid && sid !== 'mobile_default' ? sid : '';
  };
  const liveSid = normalize(window.__pmChat?.activeSessionId);
  if (liveSid) return liveSid;
  const hash = String(window.location?.hash || '');
  const match = hash.match(/^#mobile\/chat\/([^/?#]+)/);
  if (match) {
    try { return normalize(decodeURIComponent(match[1])); }
    catch { return normalize(match[1]); }
  }
  try { return normalize(localStorage.getItem('pm_mobile_last_chat_session')); }
  catch { return ''; }
}

function _isActiveDrawerSession(sessionId) {
  const activeId = _activeDrawerSessionId();
  return !!activeId && String(sessionId || '').trim() === activeId;
}


function _sessionPageHtml(pageState, emptyText) {
  const sessions = Array.isArray(pageState?.sessions) ? pageState.sessions : [];
  if (!sessions.length && pageState?.loading) return '<div class="pm-session-empty">Loading...</div>';
  if (!sessions.length && pageState?.error) return '<div class="pm-session-empty">Could not load sessions.</div>';
  // Filter out pinned sessions — they appear in the dedicated pinned section above
  const pinnedIds = _getPinnedSessionIds();
  const unpinned = pinnedIds.length ? sessions.filter(s => !pinnedIds.includes(String(s.id))) : sessions;
  if (!unpinned.length && !pageState?.hasMore && !pageState?.loading) return `<div class="pm-session-empty">${emptyText}</div>`;
  return [
    unpinned.map((s) => _sessionButtonHtml(s)).join(''),
    pageState?.error ? '<div class="pm-session-empty">Could not load more chats.</div>' : '',
    pageState?.hasMore ? '<button class="pm-session-load-more" type="button" data-session-load-more>Load more chats</button>' : '',
    pageState?.loading ? '<div class="pm-session-empty pm-session-loading">Loading more...</div>' : '',
  ].filter(Boolean).join('');
}

// Long-press wiring for session rows — 480ms hold triggers haptic + context sheet.
const _SESS_LONG_PRESS_MS = 480;
const _SESS_MOVE_CANCEL_PX = 10;
let _sessLongPressTimer = null;
let _sessLongFired = false;
let _sessLongTargetId = null;
let _sessLongTargetTitle = null;
let _sessLongStartX = 0;
let _sessLongStartY = 0;
let _sessLongCallbacks = null;

function _wireDrawerLongPress(callbacks) {
  if (!_drawerEl) return;
  // Store callbacks so the context sheet can use them
  _sessLongCallbacks = callbacks;

  // Resolve a session button from either the button itself or the haptic overlay host.
  var _resolveSessionButton = function(node) {
    if (!node || !node.closest) return null;
    var btn = node.closest('[data-session-id]');
    if (btn) return btn;
    var host = node.closest('.pm-haptic-host');
    if (host) return host.querySelector('[data-session-id]');
    return null;
  };

  // Remove old delegated handlers if already bound (re-wired on every render)
  if (_drawerEl._pmLongPressDown) _drawerEl.removeEventListener('pointerdown', _drawerEl._pmLongPressDown);
  if (_drawerEl._pmLongPressMove) _drawerEl.removeEventListener('pointermove', _drawerEl._pmLongPressMove);
  if (_drawerEl._pmLongPressUp) { _drawerEl.removeEventListener('pointerup', _drawerEl._pmLongPressUp); _drawerEl.removeEventListener('pointercancel', _drawerEl._pmLongPressUp); }

  var onDown = function(e) {
    var sessionBtn = _resolveSessionButton(e.target);
    if (!sessionBtn) return;
    _sessLongFired = false;
    _sessLongTargetId = sessionBtn.getAttribute('data-session-id');
    _sessLongTargetTitle = (sessionBtn.querySelector('.pm-session-title') || {}).textContent || '';
    _sessLongStartX = e.clientX;
    _sessLongStartY = e.clientY;
    if (_sessLongPressTimer) clearTimeout(_sessLongPressTimer);
    _sessLongPressTimer = setTimeout(function() {
      _sessLongPressTimer = null;
      _sessLongFired = true;
      pmHaptic(18);
      sessionBtn.classList.add('pm-session-long-pressed');
      setTimeout(function() { sessionBtn.classList.remove('pm-session-long-pressed'); }, 300);
      _openSessionContextSheet(_sessLongTargetId, _sessLongTargetTitle, _sessLongCallbacks || {});
    }, _SESS_LONG_PRESS_MS);
  };

  var onMove = function(e) {
    if (!_sessLongPressTimer) return;
    var dx = Math.abs(e.clientX - _sessLongStartX);
    var dy = Math.abs(e.clientY - _sessLongStartY);
    // Cancel on any movement — vertical scroll or horizontal swipe
    if (dx > _SESS_MOVE_CANCEL_PX || dy > _SESS_MOVE_CANCEL_PX) {
      clearTimeout(_sessLongPressTimer);
      _sessLongPressTimer = null;
      _sessLongFired = false;
    }
  };

  var onUp = function() {
    if (_sessLongPressTimer) { clearTimeout(_sessLongPressTimer); _sessLongPressTimer = null; }
  };

  _drawerEl._pmLongPressDown = onDown;
  _drawerEl._pmLongPressMove = onMove;
  _drawerEl._pmLongPressUp = onUp;
  _drawerEl.addEventListener('pointerdown', onDown);
  _drawerEl.addEventListener('pointermove', onMove);
  _drawerEl.addEventListener('pointerup', onUp);
  _drawerEl.addEventListener('pointercancel', onUp);

  // Suppress the normal click that fires after a long-press release
  if (!_drawerEl._pmLongPressClickGuard) {
    _drawerEl._pmLongPressClickGuard = true;
    _drawerEl.addEventListener('click', function(e) {
      if (_sessLongFired) {
        var sessionBtn = _resolveSessionButton(e.target);
        if (sessionBtn) { e.stopImmediatePropagation(); e.preventDefault(); _sessLongFired = false; }
      }
    }, true);
  }
}


function _renderDrawerPinnedSessions(pageState) {
  var pinnedEl = _drawerEl && _drawerEl.querySelector('#pm-drawer-pinned-list');
  if (!pinnedEl) return;
  var pinnedIds = _getPinnedSessionIds();
  if (!pinnedIds.length) { pinnedEl.innerHTML = ''; return; }
  var sessions = Array.isArray(pageState && pageState.sessions) ? pageState.sessions : [];
  var pinnedSessions = pinnedIds
    .map(function(id) { return sessions.find(function(s) { return String(s.id) === String(id); }); })
    .filter(Boolean);
  if (!pinnedSessions.length) { pinnedEl.innerHTML = ''; return; }
  pinnedEl.innerHTML =
    '<div class="pm-drawer-pinned-section">' +
      '<div class="pm-drawer-section-title">Pinned</div>' +
      pinnedSessions.map(function(s) { return _sessionButtonHtml(s); }).join('') +
    '</div>';
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
    const openSession = () => {
      const sessionId = btn.getAttribute('data-session-id');
      closeDrawer();
      if (typeof onOpenSession === 'function') onOpenSession(sessionId);
    };
    // A native switch overlay can turn the end of an iOS scroll into a click.
    // Keep rows native so WebKit suppresses activation after a drag, and only
    // trigger haptics after an actual button click.
    btn.addEventListener('click', () => {
      pmHaptic(10);
      openSession();
    });
  });
  _wireDrawerLongPress({ onOpenSession, loadSessions, searchSessions, onNewChat });
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
      const openSession = () => {
        const sessionId = btn.getAttribute('data-session-id');
        closeDrawer();
        if (typeof onOpenSession === 'function') onOpenSession(sessionId);
      };
      btn.addEventListener('click', () => {
        pmHaptic(10);
        openSession();
      });
    });
    _wireDrawerLongPress({ onOpenSession, loadSessions, searchSessions, onNewChat });

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
  const isActive = _isActiveDrawerSession(session?.id);
  const activeClass = isActive ? ' is-active-session' : '';
  const ariaCurrent = isActive ? ' aria-current="page"' : '';
  return `
    <button class="pm-session-row${state.stateClass}${activeClass}" type="button" data-session-id="${escapeHtml(session.id)}" data-session-state="${state.stateName}"${ariaCurrent}>
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
  const isActive = _isActiveDrawerSession(session?.id);
  const activeClass = isActive ? ' is-active-session' : '';
  const ariaCurrent = isActive ? ' aria-current="page"' : '';
  const projectLabel = session?.projectName ? ' · ' + escapeHtml(session.projectName) : '';
  return `
    <button class="pm-session-row pm-search-result-row${state.stateClass}${activeClass}" type="button" data-session-id="${escapeHtml(session.id)}" data-session-state="${state.stateName}"${ariaCurrent}>
      <span class="pm-session-row-top"><span class="pm-session-title">${escapeHtml(title)}</span>${state.stateLabel}</span>
      <span class="pm-search-meta">${escapeHtml(channel || 'Chat')}${projectLabel}</span>
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

// ── Session context sheet (long-press menu) ───────────────────────────────────
function _closeSessionSheet() {
  const scrim = document.getElementById('pm-sess-sheet-scrim');
  const sheet = document.getElementById('pm-sess-sheet');
  if (scrim) scrim.classList.remove('open');
  if (sheet) sheet.classList.remove('open');
  setTimeout(() => { scrim && scrim.remove(); sheet && sheet.remove(); }, 240);
}

function _closeSessionSheetImmediate() {
  document.getElementById('pm-sess-sheet-scrim') && document.getElementById('pm-sess-sheet-scrim').remove();
  document.getElementById('pm-sess-sheet') && document.getElementById('pm-sess-sheet').remove();
}

function _openSessionContextSheet(sessionId, sessionTitle, callbacks) {
  _closeSessionSheetImmediate();
  const pinned = _isPinned(sessionId);
  const cb = callbacks || {};

  const scrim = document.createElement('div');
  scrim.id = 'pm-sess-sheet-scrim';
  scrim.className = 'pm-msheet-scrim';

  const sheet = document.createElement('div');
  sheet.id = 'pm-sess-sheet';
  sheet.className = 'pm-msheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Chat options');

  const pinLabel = pinned ? 'Unpin from top' : 'Pin to top';
  const pinCheck = pinned ? '<span class="pm-sess-pinned-check">&#x1F4CC;</span>' : '';
  const titleSafe = escapeHtml(sessionTitle || 'Chat');
  const pinIconSvg = ICONS.pin;
  const trashIconSvg = ICONS.trash;
  const wandIconSvg = ICONS.wand || ICONS.doc;

  sheet.innerHTML =
    '<div class="pm-msheet-handle"></div>' +
    '<div class="pm-msheet-head">' +
      '<div class="pm-msheet-title pm-sess-sheet-title">' + titleSafe + '</div>' +
      '<button type="button" class="pm-msheet-close" aria-label="Close">&times;</button>' +
    '</div>' +
    '<div class="pm-msheet-body" id="pm-sess-sheet-body">' +
      '<div class="pm-msheet-rows">' +
        '<button type="button" class="pm-msheet-row pm-sess-action-row" data-sess-action="rename">' +
          '<span class="pm-sess-action-icon pm-i">' + wandIconSvg + '</span>' +
          '<span class="pm-msheet-row-label">Rename</span>' +
        '</button>' +
        '<button type="button" class="pm-msheet-row pm-sess-action-row" data-sess-action="pin">' +
          '<span class="pm-sess-action-icon pm-i">' + pinIconSvg + '</span>' +
          '<span class="pm-msheet-row-label">' + pinLabel + '</span>' +
          pinCheck +
        '</button>' +
        '<button type="button" class="pm-msheet-row pm-sess-action-row pm-sess-action-delete" data-sess-action="delete">' +
          '<span class="pm-sess-action-icon pm-i">' + trashIconSvg + '</span>' +
          '<span class="pm-msheet-row-label pm-sess-delete-label">Delete chat</span>' +
        '</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(scrim);
  document.body.appendChild(sheet);
  requestAnimationFrame(function() { scrim.classList.add('open'); sheet.classList.add('open'); });

  var close = function() { _closeSessionSheet(); };
  scrim.addEventListener('click', close);
  var closeBtn = sheet.querySelector('.pm-msheet-close');
  if (closeBtn) closeBtn.addEventListener('click', close);

  var renameBtn = sheet.querySelector('[data-sess-action="rename"]');
  if (renameBtn) renameBtn.addEventListener('click', function() {
    _closeSessionSheetImmediate();
    _openSessionRenameSheet(sessionId, sessionTitle, cb);
  });

  var pinBtn = sheet.querySelector('[data-sess-action="pin"]');
  if (pinBtn) pinBtn.addEventListener('click', function() {
    pmHaptic(10);
    var nowPinned = _togglePin(sessionId);
    close();
    if (_drawerEl && _drawerCallbacks) {
      _resetDrawerPageState(_currentDrawerSessionChannel());
      _renderDrawerSessions(_drawerCallbacks).catch(function() {});
    }
    try { if (window.pmToast) window.pmToast(nowPinned ? 'Chat pinned to top' : 'Chat unpinned', 'success'); } catch(e) {}
  });

  var deleteBtn = sheet.querySelector('[data-sess-action="delete"]');
  if (deleteBtn) deleteBtn.addEventListener('click', function() {
    _closeSessionSheetImmediate();
    _openSessionDeleteConfirmSheet(sessionId, sessionTitle, cb);
  });
}

function _openSessionRenameSheet(sessionId, currentTitle, callbacks) {
  _closeSessionSheetImmediate();
  var cb = callbacks || {};

  var scrim = document.createElement('div');
  scrim.id = 'pm-sess-sheet-scrim';
  scrim.className = 'pm-msheet-scrim';

  var sheet = document.createElement('div');
  sheet.id = 'pm-sess-sheet';
  sheet.className = 'pm-msheet pm-msheet-rename';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');

  var titleSafe = escapeHtml(currentTitle || '');
  sheet.innerHTML =
    '<div class="pm-msheet-handle"></div>' +
    '<div class="pm-msheet-head">' +
      '<div class="pm-msheet-title">Rename Chat</div>' +
      '<button type="button" class="pm-msheet-close" aria-label="Close">&times;</button>' +
    '</div>' +
    '<div class="pm-msheet-body" id="pm-sess-sheet-body">' +
      '<div class="pm-sess-rename-wrap">' +
        '<input id="pm-sess-rename-input" class="pm-sess-rename-input" type="text" maxlength="200" placeholder="Chat name\u2026" autocomplete="off" spellcheck="false" enterkeyhint="done" inputmode="text" />' +
      '</div>' +
      '<p class="pm-sess-rename-hint">Rename applies on both desktop and mobile.</p>' +
    '</div>';

  document.body.appendChild(scrim);
  document.body.appendChild(sheet);

  // --- Keyboard-following: mirror the composer's visualViewport pattern ---
  var _renameVvCleanup = null;
  var _vv = window.visualViewport || null;
  function _applyRenameKbOffset() {
    var offset = _vv ? Math.max(0, Math.round(window.innerHeight - _vv.height - (_vv.offsetTop || 0))) : 0;
    var isOpen = offset > 90;
    sheet.style.bottom = isOpen ? (offset + 8) + 'px' : '';
    sheet.style.maxHeight = isOpen ? Math.min((_vv ? _vv.height : window.innerHeight) - 24, 420) + 'px' : '';
    // Scroll doc back to top so iOS doesn't lift the fixed sheet above the keyboard
    try {
      if (window.pageYOffset) window.scrollTo(0, 0);
      var de = document.scrollingElement || document.documentElement;
      if (de && de.scrollTop) de.scrollTop = 0;
    } catch (e) {}
  }
  if (_vv) {
    _vv.addEventListener('resize', _applyRenameKbOffset);
    _vv.addEventListener('scroll', _applyRenameKbOffset);
    _renameVvCleanup = function() {
      _vv.removeEventListener('resize', _applyRenameKbOffset);
      _vv.removeEventListener('scroll', _applyRenameKbOffset);
    };
  }

  // Focus synchronously (required for iOS keyboard to open)
  var _renameInput = document.getElementById('pm-sess-rename-input');
  if (_renameInput) { _renameInput.value = currentTitle || ''; _renameInput.focus(); _renameInput.select(); }
  requestAnimationFrame(function() {
    scrim.classList.add('open');
    sheet.classList.add('open');
    // Fallback: iOS sometimes needs a second focus call once the sheet is visible
    var input = document.getElementById('pm-sess-rename-input');
    if (input) {
      if (!input.value) input.value = currentTitle || '';
      setTimeout(function() { input.focus(); input.select(); _applyRenameKbOffset(); }, 80);
    }
  });

  var close = function() {
    if (_renameVvCleanup) { _renameVvCleanup(); _renameVvCleanup = null; }
    _closeSessionSheet();
  };
  scrim.addEventListener('click', close);
  var closeBtn = sheet.querySelector('.pm-msheet-close');
  if (closeBtn) closeBtn.addEventListener('click', close);


  var doSave = async function() {
    var input = document.getElementById('pm-sess-rename-input');
    var newTitle = input ? String(input.value || '').trim() : '';
    if (!newTitle) {
      try { if (window.pmToast) window.pmToast('Name cannot be empty', 'error'); } catch(e) {}
      return;
    }
    var saveBtn = document.getElementById('pm-sess-rename-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving\u2026'; }
    try {
      await mobileGatewayFetch('/api/sessions/' + encodeURIComponent(sessionId), {
        method: 'PATCH',
        body: JSON.stringify({ title: newTitle }),
      });
      pmHaptic(10);
      close();
      if (_drawerEl && _drawerCallbacks) {
        _resetDrawerPageState(_currentDrawerSessionChannel());
        _renderDrawerSessions(_drawerCallbacks).catch(function() {});
      }
      try { window.dispatchEvent(new CustomEvent('pm-session-renamed', { detail: { sessionId: sessionId, title: newTitle } })); } catch(e) {}
      try { if (window.pmToast) window.pmToast('Chat renamed', 'success'); } catch(e) {}
    } catch(err) {
      try { if (window.pmToast) window.pmToast((err && err.message) || 'Could not rename chat', 'error'); } catch(e) {}
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    }
  };

  var renameInput = document.getElementById('pm-sess-rename-input');
  if (renameInput) renameInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); doSave(); }
    if (e.key === 'Escape') close();
  });
}

function _openSessionDeleteConfirmSheet(sessionId, sessionTitle, callbacks) {
  _closeSessionSheetImmediate();
  var cb = callbacks || {};

  var scrim = document.createElement('div');
  scrim.id = 'pm-sess-sheet-scrim';
  scrim.className = 'pm-msheet-scrim';

  var sheet = document.createElement('div');
  sheet.id = 'pm-sess-sheet';
  sheet.className = 'pm-msheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');

  var titleSafe = escapeHtml(sessionTitle || 'This chat');
  var trashIconSvg = ICONS.trash;
  sheet.innerHTML =
    '<div class="pm-msheet-handle"></div>' +
    '<div class="pm-msheet-head">' +
      '<div class="pm-msheet-title pm-sess-delete-title">Delete Chat?</div>' +
      '<button type="button" class="pm-msheet-close" aria-label="Close">&times;</button>' +
    '</div>' +
    '<div class="pm-msheet-body" id="pm-sess-sheet-body">' +
      '<p class="pm-sess-delete-msg">\u201C<strong>' + titleSafe + '</strong>\u201D will be permanently deleted and cannot be undone.</p>' +
      '<div class="pm-msheet-rows pm-sess-confirm-rows">' +
        '<button type="button" class="pm-msheet-row pm-sess-action-row pm-sess-action-delete" id="pm-sess-confirm-delete">' +
          '<span class="pm-sess-action-icon pm-i">' + trashIconSvg + '</span>' +
          '<span class="pm-msheet-row-label pm-sess-delete-label">Delete permanently</span>' +
        '</button>' +
        '<button type="button" class="pm-msheet-row pm-sess-action-row" id="pm-sess-cancel-delete">' +
          '<span class="pm-msheet-row-label">Cancel</span>' +
        '</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(scrim);
  document.body.appendChild(sheet);
  requestAnimationFrame(function() { scrim.classList.add('open'); sheet.classList.add('open'); });

  var close = function() { _closeSessionSheet(); };
  scrim.addEventListener('click', close);
  var closeBtn = sheet.querySelector('.pm-msheet-close');
  if (closeBtn) closeBtn.addEventListener('click', close);
  var cancelBtn = document.getElementById('pm-sess-cancel-delete');
  if (cancelBtn) cancelBtn.addEventListener('click', close);

  var confirmBtn = document.getElementById('pm-sess-confirm-delete');
  if (confirmBtn) confirmBtn.addEventListener('click', async function() {
    confirmBtn.disabled = true;
    var lbl = confirmBtn.querySelector('.pm-msheet-row-label');
    if (lbl) lbl.textContent = 'Deleting\u2026';
    try {
      await mobileGatewayFetch('/api/sessions/' + encodeURIComponent(sessionId), { method: 'DELETE' });
      pmHaptic(14);
      // Remove from pin list
      _savePinnedSessionIds(_getPinnedSessionIds().filter(function(id) { return id !== sessionId; }));
      // Clear any localStorage keys containing this session id
      try {
        var keysToRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(sessionId) !== -1) keysToRemove.push(k);
        }
        keysToRemove.forEach(function(k) { localStorage.removeItem(k); });
      } catch(e) {}
      close();
      if (_drawerEl && _drawerCallbacks) {
        _resetDrawerPageState(_currentDrawerSessionChannel());
        _renderDrawerSessions(_drawerCallbacks).catch(function() {});
      }
      try { window.dispatchEvent(new CustomEvent('pm-session-deleted', { detail: { sessionId: sessionId } })); } catch(e) {}
      try { if (window.pmToast) window.pmToast('Chat deleted', 'success'); } catch(e) {}
    } catch(err) {
      try { if (window.pmToast) window.pmToast((err && err.message) || 'Could not delete chat', 'error'); } catch(e) {}
      confirmBtn.disabled = false;
      var lbl2 = confirmBtn.querySelector('.pm-msheet-row-label');
      if (lbl2) lbl2.textContent = 'Delete permanently';
    }
  });
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
  document.body.classList.add('pm-mobile-drawer-open');
  _drawerEl.classList.add('open');
  _scrimEl.classList.add('open');
  if (_drawerCallbacks) {
    _renderDrawerSessions(_drawerCallbacks).catch(() => {});
    setTimeout(() => refreshMobileDrawerSessions({ force: false }).catch(() => {}), 180);
  }
}

export function closeDrawer() {
  if (!_drawerEl || !_scrimEl) return;
  document.body.classList.remove('pm-mobile-drawer-open');
  _drawerEl.classList.remove('open');
  _scrimEl.classList.remove('open');
  setTimeout(() => document.dispatchEvent(new CustomEvent('pm-drawer-closed')), 0);
}

export function renderMobileHeader({ title, online = true, leftIcon = 'menu', onLeft, onSettings, extras = '', rightActions = '', hideTitle = false, hideBrand = false }) {
  const settingsButton = `<button class="pm-icon-btn" data-action="settings" aria-label="More">${ICONS.dots}</button>`;
  const modelBadge = online ? `<button type="button" class="pm-online pm-model-badge" aria-live="polite" aria-label="Current model — tap for reasoning, hold to switch model">
          <span class="pm-model-speed-icon" aria-label="Fast mode" title="Fast mode" ${window.__pmModelBadgeFast ? '' : 'hidden'}>⚡</span>
          <span class="pm-model-badge-label">${escapeHtml(mobileModelBadgeSeedLabel())}</span>
          <input type="checkbox" switch class="pm-haptic-switch-overlay" aria-hidden="true" tabindex="-1" />
        </button>` : '';
  const headerRightActions = String(rightActions || '').trim()
    ? `<span class="pm-header-action-cluster">
          ${rightActions}
          ${settingsButton}
        </span>`
    : settingsButton;
  return `
    <header class="pm-header${hideBrand ? ' pm-header-hide-brand' : ''}">
      <button class="pm-icon-btn" data-action="${leftIcon === 'back' ? 'back' : 'menu'}" aria-label="${leftIcon === 'back' ? 'Back' : 'Menu'}">${ICONS[leftIcon]}</button>
      ${modelBadge}
      <div class="pm-brand"><span class="pm-brand-flame">🔥</span><span>Prometheus</span></div>
      <div class="pm-header-actions">
        ${headerRightActions}
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
        <button type="button" class="pm-canvas-sheet-save-btn" id="pm-canvas-fullscreen" style="display:none;" aria-label="Open fullscreen canvas">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5"/><path d="M16 3h5v5"/><path d="M21 16v5h-5"/><path d="M3 16v5h5"/></svg>
          Fullscreen
        </button>
        <button type="button" class="pm-canvas-sheet-save-btn" id="pm-canvas-preview" style="display:none;" aria-label="Render preview">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12s1.5-3 4-3 4 3 4 3-1.5 3-4 3-4-3-4-3z"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>
          Preview
        </button>
        <button type="button" class="pm-canvas-sheet-save-btn" id="pm-canvas-save" aria-label="Save current canvas file">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Save
        </button>
      </div>
      <button type="button" class="pm-canvas-fullscreen-exit" id="pm-canvas-fullscreen-exit" aria-label="Exit fullscreen canvas">✕</button>
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
          openMode: String(file.openMode || ''),
        });
        api.activeIdx = api.tabs.length - 1;
      }
      api._render();
      sheetEl.classList.add('open');
    },

    close() {
      api.setFullscreen(false);
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
      const fullscreenBtn = document.getElementById('pm-canvas-fullscreen');
      const interactionToggle = document.getElementById('pm-canvas-interaction-toggle');
      if (!tabsEl || !bodyEl) return;

      const tab = api.tabs[api.activeIdx] || null;
      if (tab && !normalizeCanvasInteractionMode(tab.interactionMode)) {
        tab.interactionMode = defaultCanvasInteractionMode(tab);
      }
      const liveWebCanvas = !!(tab && isLiveWebCanvasFile(tab));
      bodyEl.classList.toggle('has-live-frame', liveWebCanvas);

      tabsEl.innerHTML = api.tabs.map((t, i) => `
        <button type="button" class="pm-canvas-sheet-tab${i === api.activeIdx ? ' active' : ''}" data-cs-tab="${i}" title="${escapeHtml(t.name)}">
          <span class="pm-canvas-sheet-tab-name">${escapeHtml(t.name)}</span>
          <span class="pm-canvas-sheet-tab-close" data-cs-close="${i}">×</span>
        </button>
      `).join('');

      if (fileNameEl) fileNameEl.textContent = tab?.name || '';
      if (saveEl) {
        saveEl.disabled = !tab;
        saveEl.dataset.href = tab?.download || tab?.src || '';
        saveEl.dataset.filename = tab?.name || 'file';
      }

      // Show Preview button for file types that benefit from screenshot rendering
      const previewable = tab && tab.path && !['image', 'video', 'audio'].includes(tab.kind);
      if (previewBtn) previewBtn.style.display = previewable ? '' : 'none';
      if (fullscreenBtn) fullscreenBtn.style.display = tab ? '' : 'none';
      const iframeBacked = !!(tab && !['image', 'video', 'audio'].includes(tab.kind));
      if (interactionToggle) {
        interactionToggle.style.display = iframeBacked && !liveWebCanvas ? 'inline-flex' : 'none';
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
      } else if (isLiveWebCanvasFile(tab)) {
        tab.interactionMode = 'interact';
        const liveSrc = canvasWorkspaceUrl(tab);
        bodyEl.innerHTML = canvasLiveFrameHtml(`<iframe src="${escapeHtml(liveSrc)}" title="${escapeHtml(tab.name)}" sandbox="allow-scripts allow-downloads" referrerpolicy="no-referrer"></iframe>`);
      } else if (tab.openMode === 'diff' && isCanvasCodeExt(getCanvasFileExt(tab)) && tab._canvasPreviewView !== 'full') {
        // Opened from the end-of-turn diff card: default to the collapsed,
        // syntax-highlighted edited-regions view (Codex-style). The Preview
        // button flips _canvasPreviewView to toggle full \u2194 edits.
        renderCanvasCodePreview(bodyEl, tab);
      } else {
        // Text-like files (md, txt, json, code, logs): render readable, scrollable
        // content into a srcdoc iframe instead of the raw byte stream. This both
        // fixes scrolling (the text iframe scrolls natively, independent of the
        // pinch-zoom viewport) and gives clean Markdown formatting.
        renderCanvasTextInto(bodyEl, tab);
      }
      applyCanvasInteractionMode(sheetEl, bodyEl, tab);
    },

    setFullscreen(enabled) {
      const active = !!enabled && !!api.tabs[api.activeIdx];
      sheetEl.classList.toggle('is-fullscreen', active);
      document.body.classList.toggle('pm-canvas-fullscreen-open', active);
      const btn = document.getElementById('pm-canvas-fullscreen');
      if (btn) {
        btn.setAttribute('aria-pressed', String(active));
        btn.setAttribute('aria-label', active ? 'Canvas is fullscreen' : 'Open fullscreen canvas');
      }
    },

    toggleFullscreen() {
      api.setFullscreen(!sheetEl.classList.contains('is-fullscreen'));
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
  document.getElementById('pm-canvas-fullscreen')?.addEventListener('click', () => api.toggleFullscreen());
  document.getElementById('pm-canvas-fullscreen-exit')?.addEventListener('click', () => api.setFullscreen(false));
  document.getElementById('pm-canvas-save')?.addEventListener('click', () => saveActiveCanvasFile(api));
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && sheetEl.classList.contains('is-fullscreen')) api.setFullscreen(false);
  });

  // Preview button — render a screenshot of the current file via /api/preview/screenshot
  document.getElementById('pm-canvas-preview').addEventListener('click', async () => {
    const tab = api.tabs[api.activeIdx];
    if (!tab?.path) return;
    const bodyEl = document.getElementById('pm-canvas-body');
    const btn = document.getElementById('pm-canvas-preview');
    if (!bodyEl || !btn) return;
    // Markdown: render clean formatted MD inline (no screenshot round-trip).
    if (getCanvasFileExt(tab) === 'md') {
      renderCanvasTextInto(bodyEl, tab);
      return;
    }
    // Code files: Preview is a format/scope toggle.
    //  - From a diff open (collapsed edits by default): flip to the full highlighted file, then back.
    //  - From a normal open (full file by default): flip to the collapsed edited-regions view, then back.
    if (isCanvasCodeExt(getCanvasFileExt(tab))) {
      if (tab.openMode === 'diff') {
        tab._canvasPreviewView = tab._canvasPreviewView === 'full' ? 'edits' : 'full';
        if (tab._canvasPreviewView === 'full') renderCanvasTextInto(bodyEl, tab);
        else renderCanvasCodePreview(bodyEl, tab);
      } else {
        tab._canvasPreviewView = tab._canvasPreviewView === 'edits' ? 'full' : 'edits';
        if (tab._canvasPreviewView === 'edits') renderCanvasCodePreview(bodyEl, tab);
        else renderCanvasTextInto(bodyEl, tab);
      }
      return;
    }
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

  // Global delegated handler — intercepts all generated image selectors and data-pm-media taps anywhere in the app
  document.body.addEventListener('click', (ev) => {
    const generatedThumb = ev.target?.closest?.('[data-pm-generated-thumb]');
    if (generatedThumb) {
      ev.preventDefault();
      ev.stopPropagation();
      const batch = generatedThumb.closest('.pm-generated-image-batch');
      const primary = batch?.querySelector?.('[data-pm-generated-primary]');
      const img = primary?.querySelector?.('img');
      const name = generatedThumb.getAttribute('data-name') || 'Generated image';
      const src = generatedThumb.getAttribute('data-src') || '';
      if (primary) {
        ['kind', 'src', 'download', 'name', 'path', 'index'].forEach((key) => {
          const attr = `data-${key}`;
          const value = generatedThumb.getAttribute(attr) || '';
          primary.setAttribute(attr, value);
        });
      }
      if (img && src) {
        img.src = src;
        img.alt = name;
        try { img.decode?.().catch?.(() => {}); } catch {}
      }
      const nameEl = primary?.querySelector?.('b');
      if (nameEl) nameEl.textContent = name;
      batch?.querySelectorAll?.('[data-pm-generated-thumb]')?.forEach((thumb) => thumb.classList.toggle('selected', thumb === generatedThumb));
      return;
    }

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

function canvasSheetToast(message, kind = 'info') {
  try {
    if (typeof window.pmToast === 'function') {
      window.pmToast(message, kind);
      return;
    }
  } catch {}
  try { console.info('[mobile canvas]', message); } catch {}
}

function canvasFilenameFromDisposition(value, fallback = 'file') {
  const header = String(value || '');
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf?.[1]) {
    try { return decodeURIComponent(utf[1]).replace(/[/\\]+/g, '-'); } catch {}
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return String(plain?.[1] || fallback || 'file').replace(/[/\\]+/g, '-');
}

async function saveActiveCanvasFile(api) {
  const tab = api?.tabs?.[api.activeIdx];
  const saveBtn = document.getElementById('pm-canvas-save');
  const href = String(tab?.download || tab?.src || saveBtn?.dataset?.href || '').trim();
  if (!tab || !href || href === '#') {
    canvasSheetToast('No file is open to save.', 'error');
    return;
  }
  const previous = saveBtn?.innerHTML || '';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = 'Saving...';
  }
  try {
    const res = await fetch(href, { credentials: 'include' });
    if (!res.ok) throw new Error(`Save failed (${res.status})`);
    const blob = await res.blob();
    const filename = canvasFilenameFromDisposition(res.headers.get('Content-Disposition'), tab.name || 'file');
    const mimeType = blob.type || 'application/octet-stream';
    const file = typeof File !== 'undefined' ? new File([blob], filename, { type: mimeType }) : null;
    if (file && navigator.canShare?.({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({ files: [file], title: filename });
      } catch (err) {
        if (err?.name === 'AbortError') return;
        throw err;
      }
      canvasSheetToast('Ready to save from the share sheet.', 'success');
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      canvasSheetToast('Download started.', 'success');
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
    }
  } catch (err) {
    canvasSheetToast(err?.message || 'Could not save this file.', 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = previous || `${ICONS.download}<span>Save</span>`;
    }
  }
}

function normalizeCanvasInteractionMode(mode) {
  const value = String(mode || '').trim().toLowerCase();
  return value === 'interact' || value === 'inspect' ? value : '';
}

function getCanvasFileExt(file = {}) {
  const source = String(file.path || file.name || file.src || '').split(/[?#]/)[0];
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

function canvasLiveFrameHtml(innerHtml) {
  return `<div class="pm-canvas-live-frame" data-canvas-live-frame>${innerHtml}</div>`;
}

// True only for files that should run as live web content (their own HTML doc).
// Everything else text-like is rendered as readable, scrollable formatted text.
function isLiveWebCanvasFile(file = {}) {
  return ['html', 'htm'].includes(getCanvasFileExt(file));
}

function canvasWorkspaceUrl(file = {}) {
  const path = String(file.path || '').trim().replace(/^\/+/, '');
  if (!path) return String(file.src || '');
  return buildWorkspaceCanvasUrl(path);
}

// Build a styled, self-contained HTML document for a text/markdown/code file.
// Mirrors the desktop ChatPage markdown render so .md shows clean formatting.
// Code file extensions that get syntax highlighting + line numbers in the canvas.
const CANVAS_CODE_EXTS = new Set([
  'js','jsx','ts','tsx','mjs','cjs','json','css','scss','less',
  'py','rb','go','rs','java','c','h','cpp','hpp','cs','php','swift','kt',
  'sh','bash','zsh','yml','yaml','toml','ini','sql','xml','vue','svelte','lua','pl'
]);

function isCanvasCodeExt(ext) {
  return CANVAS_CODE_EXTS.has(String(ext || '').toLowerCase());
}

// Self-contained, dependency-free syntax highlighter. Tokenizes a single line of
// code into spans (comments, strings, numbers, keywords, functions). Good enough
// to read code at a glance like the Codex app, with zero CDN/offline cost.
const CANVAS_CODE_KEYWORDS = new Set(('const let var function return if else for while do switch case break continue new class extends super this import from export default async await yield try catch finally throw typeof instanceof in of void delete null undefined true false public private protected static get set interface type enum namespace implements readonly as def elif lambda pass with self None True False and or not func struct map range defer go chan fn mut use pub impl trait match module require end then begin echo local').split(' '));

// Single-pass tokenizer: scans the RAW line left-to-right, classifying each token,
// and escapes every emitted segment. Because we never re-scan emitted markup, the
// keyword/function passes can't corrupt previously injected <span> attributes
// (the old multi-replace approach wrapped the literal word "class" inside
// class="tk-s", producing &class=class=... garbage).
function highlightCodeLine(line, ext) {
  const src = String(line);
  const e = String(ext || '').toLowerCase();
  const isStyle = e === 'css' || e === 'scss' || e === 'less';
  let out = '';
  let i = 0;
  const n = src.length;
  const wrap = (cls, text) => `<span class="${cls}">${escapeHtml(text)}</span>`;
  while (i < n) {
    const ch = src[i];
    const rest = src.slice(i);
    // Block comment /* ... */ (may be unterminated on this line)
    if (ch === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      out += wrap('tk-c', src.slice(i, end));
      i = end; continue;
    }
    // Line comment // ... (skip CSS where // isn't a comment)
    if (ch === '/' && src[i + 1] === '/' && !isStyle) {
      out += wrap('tk-c', src.slice(i)); i = n; continue;
    }
    // Hash comment (py/sh/yaml) — but NOT CSS hex colors (#fff)
    if (ch === '#' && !isStyle) {
      out += wrap('tk-c', src.slice(i)); i = n; continue;
    }
    // Strings: " ' `
    if (ch === '"' || ch === '\'' || ch === '`') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === ch) { j++; break; }
        j++;
      }
      out += wrap('tk-s', src.slice(i, j));
      i = j; continue;
    }
    // Numbers
    const numMatch = /^(0x[0-9a-fA-F]+|\d+\.?\d*(?:e[+-]?\d+)?)/.exec(rest);
    if (numMatch && !/[A-Za-z_$]/.test(src[i - 1] || '')) {
      out += wrap('tk-n', numMatch[0]); i += numMatch[0].length; continue;
    }
    // Identifiers / keywords / function calls
    const idMatch = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (idMatch) {
      const word = idMatch[0];
      let k = i + word.length;
      while (k < n && (src[k] === ' ' || src[k] === '\t')) k++;
      if (CANVAS_CODE_KEYWORDS.has(word)) {
        out += wrap('tk-k', word);
      } else if (src[k] === '(') {
        out += wrap('tk-f', word);
      } else {
        out += escapeHtml(word);
      }
      i += word.length; continue;
    }
    // Plain character
    out += escapeHtml(ch);
    i++;
  }
  return out;
}

// Build a styled, self-contained HTML document for a text/markdown/code file.
// opts: { changedRanges?: [{start,end}], onlyRanges?: bool, context?: number }
// - For md: clean marked render (existing behavior).
// - For code: syntax-highlighted, line-numbered rows, optional changed-line accent,
//   and optional edited-regions-only collapse with gap markers.
// - For other text: scrollable escaped <pre>.
function canvasTextDocHtml(ext, content, opts = {}) {
  const e = String(ext || '').toLowerCase();
  const baseStyle = `
    html,body{margin:0;height:auto}
    body{font-family:system-ui,-apple-system,sans-serif;line-height:1.7;padding:18px 18px 64px;color:#17243b;-webkit-text-size-adjust:100%;word-wrap:break-word;overflow-wrap:anywhere}
    h1,h2,h3{font-weight:700;margin:16px 0 8px;line-height:1.3}
    code{background:#f0f4fb;padding:2px 6px;border-radius:4px;font-size:0.88em}
    pre{background:#f0f4fb;padding:14px;border-radius:8px;overflow-x:auto}
    pre code{background:none;padding:0}
    blockquote{border-left:3px solid #3b82f6;padding-left:14px;color:#64748b;margin:10px 0}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #dbe3ee;padding:6px 10px}
    a{color:#1668e3} hr{border:none;border-top:1px solid #dbe3ee;margin:16px 0}
    img{max-width:100%;height:auto}
    /* Code view */
    .code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.55;padding:8px 0 64px;margin:0}
    .ln{display:flex;white-space:pre}
    .ln .g{flex:0 0 auto;min-width:38px;padding:0 10px 0 14px;text-align:right;color:#9aa6b8;user-select:none;border-right:1px solid #e6ecf5}
    .ln .t{flex:1 1 auto;padding:0 14px;white-space:pre;overflow-wrap:normal}
    .ln.changed{background:#eaf5ec}
    .ln.changed .g{color:#2f9e54;font-weight:600;box-shadow:inset 2px 0 0 #2f9e54}
    .gap{padding:6px 14px;color:#8a93a3;font-size:11px;background:#f6f8fc;border-top:1px solid #eef2f8;border-bottom:1px solid #eef2f8}
    .tk-c{color:#7e8aa0;font-style:italic} .tk-s{color:#1f8a4c} .tk-n{color:#b5651d}
    .tk-k{color:#9326c9;font-weight:600} .tk-f{color:#1668e3}
    @media (prefers-color-scheme: dark){
      body{color:#e6ebf5;background:#16181d}
      code,pre{background:#23262e}
      th,td{border-color:#2c313b} blockquote{color:#9aa4b5} hr{border-top-color:#2c313b}
      .ln .g{color:#5b6678;border-right-color:#262b35}
      .ln.changed{background:#16271c} .ln.changed .g{color:#56d98a;box-shadow:inset 2px 0 0 #2f9e54}
      .gap{color:#7c8696;background:#1b1e25;border-color:#262b35}
      .tk-c{color:#6b7686} .tk-s{color:#5fd38a} .tk-n{color:#e0a86a}
      .tk-k{color:#c98bf0} .tk-f{color:#6aa9ff}
    }
  `;
  let inner;
  if (e === 'md') {
    inner = renderMd(String(content || ''));
  } else if (isCanvasCodeExt(e)) {
    const lines = String(content || '').replace(/\n$/, '').split('\n');
    const changed = Array.isArray(opts.changedRanges) ? opts.changedRanges : [];
    const isChanged = (n) => changed.some((r) => n >= r.start && n <= r.end);
    const ctx = Number.isFinite(opts.context) ? opts.context : 3;
    let visible = null; // null = all lines
    if (opts.onlyRanges && changed.length) {
      const set = new Set();
      for (const r of changed) {
        for (let n = Math.max(1, r.start - ctx); n <= Math.min(lines.length, r.end + ctx); n++) set.add(n);
      }
      visible = set;
    }
    const rows = [];
    let prevShown = 0;
    for (let i = 0; i < lines.length; i++) {
      const n = i + 1;
      if (visible && !visible.has(n)) continue;
      if (visible && prevShown && n > prevShown + 1) {
        rows.push(`<div class="gap">⋯ ${n - prevShown - 1} unchanged line${n - prevShown - 1 === 1 ? '' : 's'}</div>`);
      }
      rows.push(`<div class="ln${isChanged(n) ? ' changed' : ''}"><span class="g">${n}</span><span class="t">${highlightCodeLine(lines[i], e) || '&nbsp;'}</span></div>`);
      prevShown = n;
    }
    inner = `<div class="code">${rows.join('')}</div>`;
  } else {
    inner = `<pre style="white-space:pre-wrap">${escapeHtml(String(content || ''))}</pre>`;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${baseStyle}</style></head><body>${inner}</body></html>`;
}

// Code-file Preview: fetch git changed line ranges + file content, then render a
// syntax-highlighted, edited-regions-only view with a "Show full file" toggle.
// Falls back to the full highlighted file when there are no detectable changes.
async function renderCanvasCodePreview(bodyEl, tab) {
  if (!bodyEl || !tab) return;
  const sheetEl = document.getElementById('pm-canvas-sheet');
  const ext = getCanvasFileExt(tab);
  const path = String(tab.path || '');
  if (!path) return;
  bodyEl.innerHTML = '<div class="pm-canvas-sheet-empty">Loading diff\u2026</div>';
  const renderDoc = (docHtml) => {
    bodyEl.innerHTML = `<div class="pm-canvas-textframe-wrap"><iframe class="pm-canvas-textframe" title="${escapeHtml(tab.name || 'File')}" sandbox></iframe></div>`;
    const frame = bodyEl.querySelector('iframe.pm-canvas-textframe');
    if (frame) frame.srcdoc = docHtml;
    resetCanvasZoom(bodyEl);
    sheetEl?.classList.remove('is-interacting');
    sheetEl?.classList.add('is-inspecting');
  };
  try {
    const [rangesRes, fileRes] = await Promise.all([
      fetch(`/api/canvas/diff-ranges?path=${encodeURIComponent(path)}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/canvas/file?path=${encodeURIComponent(path)}`).then((r) => r.json()).catch(() => null),
    ]);
    const content = fileRes && typeof fileRes.content === 'string' ? fileRes.content : null;
    if (content === null) { renderDoc(canvasTextDocHtml('txt', `Could not load ${tab.name || 'this file'}.`)); return; }
    const ranges = rangesRes && Array.isArray(rangesRes.ranges) ? rangesRes.ranges : [];
    const hasChanges = ranges.length > 0;
    // Default = edited-regions-only when there are changes. Toggle state lives on
    // the tab so it survives re-render within the session, but only an explicit
    // user toggle (true/false) overrides the collapsed-by-default behavior.
    let showFull;
    if (!hasChanges) {
      showFull = true; // nothing to collapse — show whole file
    } else if (typeof tab._canvasPreviewShowFull === 'boolean') {
      showFull = tab._canvasPreviewShowFull; // honor prior in-session toggle
    } else {
      showFull = false; // first open with changes → collapsed edited-regions view
    }
    const draw = () => {
      const docHtml = canvasTextDocHtml(ext, content, {
        changedRanges: ranges,
        onlyRanges: hasChanges && !showFull,
        context: 3,
      });
      renderDoc(docHtml);
      // Toggle button overlay (only meaningful when there are changes).
      if (hasChanges) {
        const bar = document.createElement('div');
        bar.className = 'pm-canvas-codebar';
        bar.innerHTML = `<button type="button" class="pm-canvas-codebtn">${showFull ? 'Show edited regions only' : 'Show full file'}</button>`;
        bar.querySelector('button').addEventListener('click', () => {
          showFull = !showFull;
          tab._canvasPreviewShowFull = showFull;
          draw();
        });
        const wrap = bodyEl.querySelector('.pm-canvas-textframe-wrap');
        if (wrap) wrap.appendChild(bar);
      }
    };
    draw();
  } catch (err) {
    renderDoc(canvasTextDocHtml('txt', `Preview failed: ${String(err?.message || err)}`));
  }
}

// Fetch a workspace text file and render it as a scrollable srcdoc iframe.
function renderCanvasTextInto(bodyEl, tab) {
  if (!bodyEl || !tab) return;
  const sheetEl = document.getElementById('pm-canvas-sheet');
  bodyEl.innerHTML = '<div class="pm-canvas-sheet-empty">Loading\u2026</div>';
  const ext = getCanvasFileExt(tab);
  const path = String(tab.path || '');
  const show = (docHtml) => {
    bodyEl.innerHTML = `<div class="pm-canvas-textframe-wrap"><iframe class="pm-canvas-textframe" title="${escapeHtml(tab.name || 'File')}" sandbox></iframe></div>`;
    const frame = bodyEl.querySelector('iframe.pm-canvas-textframe');
    if (frame) frame.srcdoc = docHtml;
    resetCanvasZoom(bodyEl);
    sheetEl?.classList.remove('is-interacting');
    sheetEl?.classList.add('is-inspecting');
  };
  if (!path) { show(canvasTextDocHtml(ext, '')); return; }
  const showError = (msg) => show(canvasTextDocHtml('txt', String(msg || 'Could not load this file.')));
  fetch(`/api/canvas/file?path=${encodeURIComponent(path)}`)
    .then((res) => res.json())
    .then((r) => {
      if (r && typeof r.content === 'string') { show(canvasTextDocHtml(ext, r.content)); return; }
      if (r && r.isImage) {
        bodyEl.innerHTML = canvasZoomHtml(`<img src="${escapeHtml(tab.src)}" alt="${escapeHtml(tab.name)}">`);
        applyCanvasInteractionMode(document.getElementById('pm-canvas-sheet'), bodyEl, tab);
        return;
      }
      // No text content: render a clean error instead of dumping raw JSON.
      const reason = r && r.error ? String(r.error) : 'This file could not be read.';
      showError(`Could not load ${tab.name || 'this file'}.\n\n${reason}`);
    })
    .catch((err) => {
      showError(`Could not load ${tab.name || 'this file'}.\n\n${err && err.message ? err.message : 'Network error.'}`);
    });
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
    content.style.transform = '';
    content.style.willChange = 'auto';
    viewport.classList.remove('is-zoomed');
    return;
  }
  content.style.willChange = 'transform';

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
    // Drop a real native iOS switch under the finger so a physical tap on the
    // header icon (menu / back / settings / new-chat) emits a system haptic —
    // the same trick the send button uses. The tap toggles the hidden switch
    // (iOS buzzes) and the click bubbles up to fire the handler below.
    if (btn.classList.contains('pm-icon-btn') && !btn.querySelector('.pm-haptic-switch-overlay')) {
      const sw = document.createElement('input');
      sw.type = 'checkbox';
      sw.setAttribute('switch', '');
      sw.className = 'pm-haptic-switch-overlay';
      sw.setAttribute('aria-hidden', 'true');
      sw.tabIndex = -1;
      btn.appendChild(sw);
    }
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
    // Haptic feedback for all header icon buttons — use direct action callbacks
    // instead of btn.click() so the hamburger reliably opens the drawer on iOS
    // (synthetic click events from the haptic overlay don't always re-trigger the
    // delegated shell listener).
    try {
      let activateFn;
      if (a === 'menu') activateFn = () => openDrawer();
      else if (a === 'back') activateFn = () => { if (onBack) onBack(); };
      else if (a === 'settings') activateFn = () => {
        if (onSettings) onSettings();
        else if (typeof window.pmOpenSettings === 'function') window.pmOpenSettings();
        else if (typeof window.openSettings === 'function') window.openSettings();
        else window.location.hash = '#mobile/settings';
      };
      else if (a === 'new-chat') activateFn = () => { if (onNewChat) onNewChat(); };
      if (activateFn) attachMobileButtonHaptic(btn, activateFn);
    } catch {}
  
  });
}

