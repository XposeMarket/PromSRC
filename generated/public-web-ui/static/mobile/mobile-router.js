// Hash router for Prometheus Mobile. Entry point loaded by index.html.
// Activates ONLY when location.hash starts with "#mobile" or pathname starts with "/mobile".
// Otherwise stays out of the way so the desktop UI is untouched.

import { createMobileShell, invalidateMobileDrawerSessions } from './mobile-shell.js?v=liquid-glass-tabbar';
import {
  renderChatPage, renderVoicePage, renderSchedulePage,
  renderTeamsPage, renderTeamDetailPage, renderPlaceholderPage,
  renderPairPage, renderTasksPage, renderMorePage, renderProposalsPage,
  renderCreativePage, renderSubagentsPage, renderSubagentDetailPage,
} from './mobile-pages.js?v=mobile-abort-button';
import { renderMobileSettingsPage } from './mobile-settings.js?v=mobile-voice-live-update-fix';
import {
  getDeviceToken,
  loadMobileSessionGroups,
  searchMobileChatSessions,
} from './mobile-api.js?v=mobile-voice-live-update-fix';

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

export function mobileRouteFromLocation() {
  let raw = (window.location.hash || '').replace(/^#/, '');
  if (!raw && (window.location.pathname || '').startsWith('/mobile')) {
    raw = window.location.pathname.replace(/^\//, '');
  }
  if (!raw.startsWith('mobile')) raw = 'mobile/chat';
  const parts = raw.split('/').filter(Boolean);
  // parts[0] = 'mobile'
  const page = parts[1] || 'chat';
  const arg  = parts[2] || null;
  const extra = parts.slice(3);
  return { page, arg, extra };
}

export function mobileNavigate(route) {
  if (!route) return;
  if (!route.startsWith('#')) route = '#' + (route.replace(/^\//, '').startsWith('mobile') ? route.replace(/^\//, '') : 'mobile/' + route.replace(/^\//, ''));
  // Preserve the `?source=pwa` query so an installed PWA never falls out of
  // PWA-launch mode through internal navigation. Other query params are kept
  // as-is — we only touch the hash.
  if (window.location.hash === route) {
    render();
  } else {
    window.location.hash = route;
  }
}

const TAB_FOR_PAGE = {
  chat: 'chat', voice: 'voice', tasks: 'tasks', creative: 'creative',
  schedule: null, teams: null, subagents: null, proposals: null, settings: null, more: null,
};

function render() {
  if (typeof window.__pmMobileCleanup === 'function') {
    try { window.__pmMobileCleanup(); } catch {}
    window.__pmMobileCleanup = null;
  }

  if (!isMobileRoute()) {
    document.body.classList.remove('pm-mobile-active');
    const root = document.getElementById('mobile-root');
    if (root) { root.hidden = true; root.innerHTML = ''; }
    return;
  }

  document.body.classList.add('pm-mobile-active');
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

  const activeTab = TAB_FOR_PAGE[page] || null;
  const shell = createMobileShell({
    activeTab,
    onNavigate: (route) => mobileNavigate(route),
    onNewChat: () => {
      try {
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

  switch (page) {
    case 'pair':
      return renderPairPage(slot, { code: pairCode, navigate: mobileNavigate });
    case 'chat':      return renderChatPage(slot, { navigate: mobileNavigate, sessionId: arg ? decodeURIComponent(arg) : null });
    case 'voice':     return renderVoicePage(slot, { navigate: mobileNavigate });
    case 'schedule':  return renderSchedulePage(slot);
    case 'teams':
      if (arg) return renderTeamDetailPage(slot, { teamId: arg, navigate: mobileNavigate, initialTab: extra?.[0] || '' });
      return renderTeamsPage(slot, { navigate: mobileNavigate });
    case 'tasks':     return renderTasksPage(slot, { navigate: mobileNavigate });
    case 'settings':  return renderMobileSettingsPage(slot, { section: arg || '', navigate: mobileNavigate });
    case 'creative':  return renderCreativePage(slot, { navigate: mobileNavigate });
    case 'subagents':
      if (arg) return renderSubagentDetailPage(slot, { agentId: decodeURIComponent(arg), navigate: mobileNavigate, initialTab: extra?.[0] || '' });
      return renderSubagentsPage(slot, { navigate: mobileNavigate });
    case 'proposals': return renderProposalsPage(slot, { proposalId: arg ? decodeURIComponent(arg) : '', navigate: mobileNavigate });
    case 'more':      return renderMorePage(slot, { section: arg || '', navigate: mobileNavigate });
    default:          return renderChatPage(slot, { navigate: mobileNavigate });
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('popstate',   render);
window.addEventListener('pm-device-revoked', render);
document.addEventListener('DOMContentLoaded', render);
if (document.readyState !== 'loading') render();

// Expose for debugging / future native shells.
window.PrometheusMobile = { navigate: mobileNavigate, render };
