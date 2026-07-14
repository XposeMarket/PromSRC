// Hash router for Prometheus Mobile. Entry point loaded by index.html.
// Activates ONLY when location.hash starts with "#mobile" or pathname starts with "/mobile".
// Otherwise stays out of the way so the desktop UI is untouched.

import { createMobileShell, invalidateMobileDrawerSessions } from './mobile-shell.js?v=mobile-drawer-scroll-v9';
import {
  renderChatPage, renderVoicePage, renderSchedulePage,
  renderTeamsPage, renderTeamDetailPage, renderPlaceholderPage,
  renderPairPage, renderTasksPage, renderMorePage, renderProposalsPage,
  renderHubPage, renderSubagentsPage, renderSubagentDetailPage,
} from './mobile-pages.js?v=stream-focus-isolation-v16';
import {
  getDeviceToken,
  loadMobileSessionGroups,
  searchMobileChatSessions,
} from './mobile-api.js?v=slash-command-style-align-v1';
import { connectWS, ensureWSConnected } from '../ws.js';

// Once a device has ever entered mobile mode (or completed pairing), this flag
// is written to localStorage so we stay in mobile mode even when the URL loses
// its `#mobile/...` fragment or `?source=pwa` query — which iOS, Android, and
// the PWA install snapshot all do at various points. Without this flag the
// "I refreshed and now I see the desktop UI on my phone" bug returns.
const PM_FORCE_MOBILE_KEY = 'pm_force_mobile';

function _readForceMobile() {
  try { return localStorage.getItem(PM_FORCE_MOBILE_KEY) === '1'; } catch { return false; }
}
function _writeForceMobile() {
  try { localStorage.setItem(PM_FORCE_MOBILE_KEY, '1'); } catch {}
}
export function clearForceMobile() {
  try { localStorage.removeItem(PM_FORCE_MOBILE_KEY); } catch {}
}

function isMobileRoute() {
  const h = (window.location.hash || '').replace(/^#/, '');
  const p = window.location.pathname || '';
  try {
    const q = new URLSearchParams(window.location.search || '');
    if (q.get('desktop') === '1' || q.get('mode') === 'desktop') return false;
  } catch {}
  if (h.startsWith('mobile') || p === '/mobile' || p.startsWith('/mobile/')) return true;
  try {
    const q = new URLSearchParams(window.location.search || '');
    if (q.get('pair')) return true;
    if (q.get('source') === 'pwa') return true;
  } catch {}
  // Sticky mobile mode: once this device has been recognised as mobile (force
  // flag set, OR a paired-device token is on file), keep mobile mode regardless
  // of URL — paired phones are by definition mobile clients.
  if (_readForceMobile()) return true;
  try { if (localStorage.getItem('pm_device_token')) return true; } catch {}
  return false;
}

function _pairCodeFromUrl() {
  try {
    const q = new URLSearchParams(window.location.search || '');
    return q.get('pair') || '';
  } catch { return ''; }
}

function normalizeMobileRouteParts(parts) {
  const clean = Array.isArray(parts) ? parts.map(p => String(p || '').trim()).filter(Boolean) : [];
  if (clean[0] === 'm') clean[0] = 'mobile';
  if (clean[0] !== 'mobile') clean.unshift('mobile');
  let page = clean[1] || 'chat';
  let arg = clean[2] || null;
  let extra = clean.slice(3);

  const aliases = {
    c: 'chat',
    v: 'voice',
    task: 'tasks',
    jobs: 'schedule',
    job: 'schedule',
    team: 'teams',
    agent: 'subagents',
    subagent: 'subagents',
    proposal: 'proposals',
    prop: 'proposals',
    approvals: 'proposals',
    creative: 'hub',
  };
  page = aliases[page] || page;
  if (!['chat', 'voice', 'schedule', 'teams', 'tasks', 'settings', 'hub', 'subagents', 'proposals', 'more', 'pair'].includes(page)) {
    extra = [arg, ...extra].filter(Boolean);
    arg = page || null;
    page = 'chat';
  }
  return { page, arg, extra };
}

export function mobileRouteFromLocation() {
  let raw = (window.location.hash || '').replace(/^#/, '');
  if (!raw && (window.location.pathname || '').startsWith('/mobile')) {
    raw = window.location.pathname.replace(/^\//, '');
  }
  if (!raw) {
    try {
      const q = new URLSearchParams(window.location.search || '');
      const route = q.get('mobile') || q.get('pm_route') || q.get('route') || '';
      if (route) raw = route.replace(/^#?\/?/, '');
    } catch {}
  }
  return normalizeMobileRouteParts(String(raw || 'mobile/chat').split('/'));
}

export function mobileDeepLink(route = 'chat', arg = '', extra = [], opts = {}) {
  const cleanRoute = String(route || 'chat').replace(/^#?\/?mobile\/?/, '').replace(/^\/+/, '') || 'chat';
  const parts = ['mobile', cleanRoute, arg, ...(Array.isArray(extra) ? extra : [extra])]
    .map(p => String(p || '').trim())
    .filter(Boolean)
    .map((p, i) => i <= 1 ? p.replace(/^\/+|\/+$/g, '') : encodeURIComponent(p));
  const suffix = parts.join('/');
  if (opts.path === true) return `/?source=pwa#${suffix}`;
  if (opts.absolute === true) return `${window.location.origin}/?source=pwa#${suffix}`;
  return `#${suffix}`;
}

export function mobileNavigate(route) {
  if (!route) return;
  if (!route.startsWith('#')) route = '#' + (route.replace(/^\//, '').startsWith('mobile') ? route.replace(/^\//, '') : 'mobile/' + route.replace(/^\//, ''));
  // Preserve the `?source=pwa` query so an installed PWA never falls out of
  // PWA-launch mode through internal navigation. Other query params are kept
  // as-is — we only touch the hash.
  if (window.location.hash === route) {
    safeRender();
  } else {
    window.location.hash = route;
  }
}

// Mobile reuses the full desktop Settings modal instead of a separate mobile
// settings surface. The same #settings-modal markup and SettingsPage.js ship in
// this bundle, and the shared api() helper attaches the paired-device token, so
// every desktop settings loader/saver authenticates correctly on a phone.
// `mobile.css` (scoped to body.pm-mobile-active) presents the modal full-screen.
function openMobileSettings(tab) {
  if (typeof window.openSettings === 'function') {
    // The desktop #settings-modal lives inside the .app container, which the
    // mobile shell hides with `display:none`. A position:fixed element nested
    // under a display:none ancestor never renders (it collapses to 0x0), so the
    // modal opened but stayed invisible. Lift it to <body> — outside the hidden
    // .app — before opening. It still matches `body.pm-mobile-active
    // #settings-modal` since it remains a descendant of <body>.
    try {
      const modal = document.getElementById('settings-modal');
      if (modal && modal.parentElement !== document.body) {
        document.body.appendChild(modal);
      }
    } catch (err) { console.warn('[mobile settings] could not reparent modal', err); }
    try { window.openSettings(tab || undefined); } catch (err) { console.warn('[mobile settings] openSettings failed', err); }
    return true;
  }
  import('../pages/SettingsPage.js?v=goal-support-routing-v11')
    .then(() => openMobileSettings(tab))
    .catch((err) => console.warn('[mobile settings] could not lazy-load SettingsPage.js', err));
  console.warn('[mobile settings] desktop Settings modal not available yet');
  return false;
}
window.pmOpenSettings = openMobileSettings;

// Close the desktop Settings modal if it is open. Used when the mobile router
// navigates to any non-settings page so the overlay never lingers on top of a
// different mobile screen.
function closeMobileSettings() {
  const modal = document.getElementById('settings-modal');
  if (modal && modal.style.display !== 'none' && typeof window.closeSettings === 'function') {
    try { window.closeSettings(); } catch {}
  }
}

const TAB_FOR_PAGE = {
  chat: 'chat', voice: 'voice', tasks: 'tasks', hub: 'hub',
  schedule: null, teams: null, subagents: null, proposals: null, settings: null, more: null,
};

function render() {
  try {
    navigator.serviceWorker?.controller?.postMessage('pm-clear-badge');
    navigator.clearAppBadge?.();
  } catch {}

  if (typeof window.__pmMobileCleanup === 'function') {
    try { window.__pmMobileCleanup(); } catch {}
    window.__pmMobileCleanup = null;
  }

  if (!isMobileRoute()) {
    document.body.classList.remove('pm-mobile-active', 'pm-mobile-document-scroll');
    const root = document.getElementById('mobile-root');
    if (root) { root.hidden = true; root.innerHTML = ''; }
    return;
  }

  document.body.classList.add('pm-mobile-active', 'pm-mobile-document-scroll');
  // Allow auth-pending body to still show mobile root.
  document.body.classList.remove('auth-pending');

  // Persist the mobile-mode decision so the device sticks in mobile mode even
  // if the URL later loses its hash/query markers (iOS PWA cold-launch, SW
  // serving cached `/`, manual address-bar typing, etc.).
  _writeForceMobile();

  // If we were activated by the sticky flag on a bare URL (no `#mobile/...`,
  // no `?pair=`), backfill the hash so the address bar reflects where the user
  // actually is. Subsequent refreshes then short-circuit via the hash check.
  const _h = (window.location.hash || '').replace(/^#/, '');
  const _p = window.location.pathname || '';
  const _hasMarker = _h.startsWith('mobile')
    || _p === '/mobile' || _p.startsWith('/mobile/')
    || _pairCodeFromUrl();
  if (!_hasMarker) {
    try { history.replaceState(null, '', (window.location.pathname || '/') + (window.location.search || '') + '#mobile/chat'); } catch {}
  }

  let { page, arg, extra } = mobileRouteFromLocation();
  const pairCode = _pairCodeFromUrl();

  // Pairing gate:
  //   - `?pair=<code>` in URL or `#mobile/pair` route → always show pair page
  //     (and consume the code from the query string for the pair flow).
  //   - No device token saved → force pair page on every other route, so an
  //     unpaired phone can never accidentally hit /api endpoints.
  if (pairCode) page = 'pair';
  else if (!getDeviceToken() && page !== 'pair') page = 'pair';

  // The desktop Settings modal can be opened on top of any mobile page (via the
  // header gear) without changing the route. Any actual navigation to a
  // different page should dismiss it so it never lingers over the wrong screen.
  if (page !== 'settings') closeMobileSettings();

  const activeTab = TAB_FOR_PAGE[page] || null;
  const shell = createMobileShell({
    activeTab,
    onNavigate: (route) => mobileNavigate(route),
    onNewChat: () => {
      try {
        localStorage.removeItem('pm_mobile_last_chat_session');
        const chat = window.__pmChat;
        if (chat && typeof chat === 'object') {
          chat.activeSessionId = 'mobile_default';
          chat.threads = chat.threads && typeof chat.threads === 'object' ? chat.threads : {};
          chat.attachments = chat.attachments && typeof chat.attachments === 'object' ? chat.attachments : {};
          chat.threads.mobile_default = [];
          chat.attachments.mobile_default = [];
          chat.editingMessageIndex = -1;
        }
        const voice = window.__pmVoice;
        if (voice && typeof voice === 'object') {
          voice.targetSessionId = 'mobile_default';
          voice.targetSessionLabel = 'Mobile - New Chat';
          voice.targetSessionChannel = 'mobile';
          voice.targetSessionForced = true;
          voice.pendingInterruptContext = null;
          voice.lastInterruptionEvent = null;
          if (voice.activeVoiceRuntime) voice.activeVoiceRuntime.isStreamActive = false;
          voice.activeVoiceRuntime = null;
        }
      } catch {}
      invalidateMobileDrawerSessions('mobile');
      mobileNavigate('#mobile/chat');
    },
    onOpenSession: (sessionId) => {
      const picker = window.__pmVoiceTargetPicker;
      if (typeof picker === 'function') {
        window.__pmVoiceTargetPicker = null;
        picker(sessionId);
      } else {
        mobileNavigate(`#mobile/chat/${encodeURIComponent(sessionId)}`);
      }
    },
    loadSessions: loadMobileSessionGroups,
    searchSessions: searchMobileChatSessions,
  });
  const slot = shell.page;
  window.__pmMobileCleanup = () => {
    if (typeof slot._pmCleanup === 'function') slot._pmCleanup();
  };
  if (getDeviceToken()) {
    queueMicrotask(() => {
      try {
        ensureWSConnected({ timeoutMs: 6000 });
      } catch {
        try { connectWS({ force: true, timeoutMs: 6000, reconnectDelayMs: 0 }); } catch {}
      }
    });
  }

  switch (page) {
    case 'pair':
      return renderPairPage(slot, { code: pairCode, navigate: mobileNavigate });
    case 'chat':      return renderChatPage(slot, { navigate: mobileNavigate, sessionId: arg ? decodeURIComponent(arg) : null });
    case 'voice':     return renderVoicePage(slot, { navigate: mobileNavigate });
    case 'schedule':  return renderSchedulePage(slot);
    case 'teams':
      if (arg) return renderTeamDetailPage(slot, { teamId: arg, navigate: mobileNavigate, initialTab: extra?.[0] || '' });
      return renderTeamsPage(slot, { navigate: mobileNavigate });
    case 'tasks':     return renderTasksPage(slot, { navigate: mobileNavigate, taskId: arg ? decodeURIComponent(arg) : '' });
    case 'settings':
      // Deep links like #mobile/settings or #mobile/settings/models open the
      // full desktop Settings modal over a chat base, so closing it lands the
      // user back on chat. `arg` maps directly to a desktop settings tab id.
      renderChatPage(slot, { navigate: mobileNavigate, sessionId: null });
      openMobileSettings(arg || undefined);
      return;
    case 'hub':       return renderHubPage(slot, { navigate: mobileNavigate });
    case 'subagents':
      if (arg) return renderSubagentDetailPage(slot, { agentId: decodeURIComponent(arg), navigate: mobileNavigate, initialTab: extra?.[0] || '' });
      return renderSubagentsPage(slot, { navigate: mobileNavigate });
    case 'proposals': return renderProposalsPage(slot, { proposalId: arg ? decodeURIComponent(arg) : '', navigate: mobileNavigate });
    case 'more':      return renderMorePage(slot, { section: arg || '', navigate: mobileNavigate });
    default:          return renderChatPage(slot, { navigate: mobileNavigate });
  }
}

function renderMobileBootError(err) {
  const root = document.getElementById('mobile-root');
  if (!root) return;
  const message = String(err?.message || err || 'Mobile boot failed.');
  const safeMessage = message.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
  document.body.classList.add('pm-mobile-active', 'pm-mobile-document-scroll');
  document.body.classList.remove('auth-pending');
  root.hidden = false;
  root.innerHTML = `
    <div class="pm-mobile-boot-screen pm-mobile-boot-error">
      <div class="pm-mobile-boot-mark"><img src="/assets/Prometheus.png" alt="Prometheus" /></div>
      <div>Prometheus Mobile could not load.</div>
      <div class="pm-mobile-boot-detail">${safeMessage}</div>
      <div class="pm-mobile-boot-actions">
        <button type="button" class="pm-btn primary" id="pm-mobile-retry-boot">Retry</button>
        <button type="button" class="pm-btn ghost" id="pm-mobile-clear-cache">Clear cache</button>
      </div>
    </div>
  `;
  root.querySelector('#pm-mobile-retry-boot')?.addEventListener('click', () => safeRender());
  root.querySelector('#pm-mobile-clear-cache')?.addEventListener('click', async () => {
    try {
      const keys = await caches?.keys?.();
      await Promise.all((keys || []).filter((key) => String(key).startsWith('prometheus-')).map((key) => caches.delete(key)));
    } catch {}
    try { location.reload(); } catch { safeRender(); }
  });
}

function safeRender() {
  try {
    const result = render();
    if (result && typeof result.catch === 'function') {
      result.catch((err) => {
        console.error('[mobile] async render failed:', err);
        renderMobileBootError(err);
      });
    }
    return true;
  } catch (err) {
    console.error('[mobile] render failed:', err);
    renderMobileBootError(err);
    return false;
  }
}

function recoverMobileBootSurface() {
  if (!isMobileRoute()) return;
  const root = document.getElementById('mobile-root');
  if (!root || root.hidden || !root.querySelector('.pm-app')) {
    safeRender();
  }
  if (getDeviceToken()) {
    try { ensureWSConnected({ timeoutMs: 6000 }); } catch {}
  }
}

window.addEventListener('hashchange', safeRender);
window.addEventListener('popstate', safeRender);
window.addEventListener('pm-device-revoked', safeRender);
window.addEventListener('online', recoverMobileBootSurface);
window.addEventListener('pageshow', recoverMobileBootSurface);
window.addEventListener('focus', recoverMobileBootSurface);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') recoverMobileBootSurface();
});

if (document.readyState === 'loading') {
  let renderedBeforeDom = false;
  if (isMobileRoute() && document.getElementById('mobile-root')) {
    queueMicrotask(() => { renderedBeforeDom = safeRender(); });
  }
  document.addEventListener('DOMContentLoaded', () => {
    if (!renderedBeforeDom) safeRender();
  });
} else {
  safeRender();
}

// Expose for debugging / future native shells.
window.PrometheusMobile = { navigate: mobileNavigate, render: safeRender };
