/**
 * app.js - F1 Scaffold
 *
 * Application init: theme, boot sequence, setMode page switching.
 *
 * This module is loaded LAST (after all page modules register their
 * WS handlers and expose their functions). It kicks off the boot
 * sequence that was previously inline at the bottom of the <script> block.
 *
 * During migration, this module coexists with the inline <script>.
 * Functions here are also exposed on window.* so the inline HTML
 * onclick handlers continue to work.
 *
 * Usage:
 *   <script type="module" src="src/app.js"></script>
 */

import { state, THEME_KEY } from './state.js';

export function getInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return 'light';
}

export function applyTheme(theme) {
  const resolved = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', resolved);
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.setAttribute('data-theme-state', resolved);
    const title = resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    toggle.title = title;
    toggle.setAttribute('aria-label', title);
  }
  try { localStorage.setItem(THEME_KEY, resolved); } catch {}
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ── Right panel (inline drawer) ───────────────────────────────
const RIGHT_PANEL_W = 380;

function _getRightPanelWidth() {
  const panel = document.getElementById('right-panel');
  if (!panel || !panel.classList.contains('open')) return 0;
  return panel.offsetWidth || RIGHT_PANEL_W;
}

function _syncPageViewPositions() {
  const sidebar = document.getElementById('sidebar');
  const collapsed = sidebar && sidebar.classList.contains('collapsed');
  const left = collapsed ? '64px' : '288px';
  const rightW = _getRightPanelWidth();
  const right = rightW > 0 ? `${rightW}px` : '0';
  document.querySelectorAll('.page-view').forEach(el => {
    el.style.setProperty('left', left, 'important');
    el.style.setProperty('right', right, 'important');
  });
  const cv = document.getElementById('connector-view');
  if (cv) { cv.style.left = left; cv.style.right = right; }
}

export function toggleRightPanel() {
  const panel = document.getElementById('right-panel');
  const toggleBtn = document.getElementById('drawerToggle');
  if (!panel) return;

  // Check current state before toggle
  const wasOpen = panel.classList.contains('open');
  const isOpen = panel.classList.toggle('open');
  if (toggleBtn) toggleBtn.classList.toggle('active', isOpen);

  // Closing: force clear inline resize styles to allow CSS width: 0 to take effect
  if (!isOpen && wasOpen) {
    // Remove all inline width properties immediately
    panel.style.removeProperty('width');
    panel.style.removeProperty('min-width');
    panel.style.removeProperty('max-width');
  } else if (isOpen && !wasOpen) {
    // Opening: keep any inline width from resize, or let CSS handle it
    const sidebar = document.getElementById('sidebar');
    if (sidebar && !sidebar.classList.contains('collapsed')) {
      toggleSidebar();
    }
  }

  _syncPageViewPositions();
}

// ── Sidebar collapse ──────────────────────────────────────────
export function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const collapsed = sidebar.classList.toggle('collapsed');
  try { localStorage.setItem('sidebar_collapsed', collapsed ? '1' : '0'); } catch {}
  _syncPageViewPositions();
}

// ── More popover ──────────────────────────────────────────────
export function toggleMorePopover(event) {
  if (event) event.stopPropagation();
  const popover = document.getElementById('morePopover');
  if (!popover) return;
  const isOpen = popover.classList.toggle('open');
  if (isOpen) {
    // Position the fixed popover next to the trigger button
    const trigger = document.getElementById('moreNavBtn');
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      popover.style.left = (rect.right + 8) + 'px';
      popover.style.top = rect.top + 'px';
    }
  }
}

export function closeMorePopover() {
  const popover = document.getElementById('morePopover');
  if (popover) popover.classList.remove('open');
}

// ── Sidebar segment tabs ──────────────────────────────────────
export function setSidebarSegTab(tab) {
  const tabs = ['chats', 'channels', 'projects', 'skills'];
  tabs.forEach(t => {
    const btn = document.querySelector(`[data-tab="${t}"]`);
    const content = document.getElementById(t === 'chats' ? 'sidebar-jobs' : `sidebar-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
    if (content) {
      // #sidebar-projects uses CSS .active class (projects.css has display:none rule)
      // Must also clear any inline display:none so the CSS class can win
      if (content.id === 'sidebar-projects') {
        content.style.removeProperty('display');
        content.classList.toggle('active', t === tab);
      } else {
        content.style.display = t === tab ? '' : 'none';
      }
    }
  });

  // Load content for the selected tab
  if (tab === 'channels' && typeof window.renderChannelsList === 'function') {
    window.renderChannelsList();
  } else if (tab === 'projects' && typeof window.renderProjectsList === 'function') {
    window.renderProjectsList();
  } else if (tab === 'skills' && typeof window.loadInstalledSkills === 'function') {
    window.loadInstalledSkills();
  }
}

// ── Page mode ─────────────────────────────────────────────────
const VALID_MODES = ['chat', 'bgtasks', 'schedule', 'teams', 'proposals', 'audit', 'memory'];

const PAGE_TITLES = {
  chat: ['Chat', 'Prometheus operator workspace'],
  bgtasks: ['Tasks', 'Background task queue'],
  schedule: ['Schedule', 'Recurring + one-off jobs'],
  teams: ['Teams', 'Managed agent teams'],
  proposals: ['Proposals', 'Agent-generated proposals awaiting approval'],
  audit: ['Audit Log', 'Non-main agent runs'],
  memory: ['Memory Graph', 'Knowledge web across sessions'],
};

export function setMode(mode) {
  if (!VALID_MODES.includes(mode)) mode = 'chat';
  state.currentMode = mode;
  window.currentMode = mode;

  // Activate correct nav item
  VALID_MODES.forEach(m => {
    const el = document.getElementById(`nav-${m}`);
    if (el) el.classList.toggle('active', m === mode);
  });
  // "More" popover items
  ['audit', 'memory'].forEach(m => {
    const el = document.getElementById(`nav-${m}`);
    if (el) el.classList.toggle('active', m === mode);
  });
  const moreBtn = document.getElementById('moreNavBtn');
  if (moreBtn) moreBtn.classList.toggle('active', mode === 'audit' || mode === 'memory');
  closeMorePopover();

  // Update page title
  const titleParts = PAGE_TITLES[mode] || ['Chat', 'Prometheus'];
  const titleEl = document.getElementById('page-title-text');
  const subEl = document.getElementById('page-title-sub');
  if (titleEl) titleEl.textContent = titleParts[0];
  if (subEl) subEl.textContent = titleParts[1];

  // Show/hide views
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

  // In v2 layout, sidebar is always visible, main/right-panel only hide for non-chat modes
  const mainEl = document.querySelector('main.main-shell');
  if (mainEl) mainEl.style.display = mode === 'chat' ? '' : 'none';

  // Right panel stays unless you close it manually (or hide for non-chat)
  const rightPanel = document.getElementById('right-panel');
  if (rightPanel && mode !== 'chat') rightPanel.classList.remove('open');
  const toggleBtn = document.getElementById('drawerToggle');
  if (toggleBtn) {
    toggleBtn.classList.remove('active');
    toggleBtn.style.display = mode === 'chat' ? '' : 'none';
  }

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

// Legacy compatibility: old header buttons still broadcast to setMode via onclick
export function toggleMoreMenu(event) { toggleMorePopover(event); }

window.setMode = setMode;
window.toggleTheme = toggleTheme;
window.applyTheme = applyTheme;
window.getInitialTheme = getInitialTheme;
window.toggleMoreMenu = toggleMoreMenu;
window.toggleMorePopover = toggleMorePopover;
window.closeMorePopover = closeMorePopover;
window.toggleSidebar = toggleSidebar;
window.toggleRightPanel = toggleRightPanel;
window.setSidebarSegTab = setSidebarSegTab;
window._syncPageViewPositions = _syncPageViewPositions;

// Close more popover when clicking outside
document.addEventListener('click', (event) => {
  const wrap = document.querySelector('.nav-more-wrap');
  if (wrap && !wrap.contains(event.target)) closeMorePopover();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMorePopover();
});

// Restore sidebar collapse state
(function() {
  try {
    if (localStorage.getItem('sidebar_collapsed') === '1') {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.add('collapsed');
      _syncPageViewPositions();
    }
  } catch {}
})();
