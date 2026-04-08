/**
 * app.js — F1 Scaffold
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

// ─── Theme ─────────────────────────────────────────────────────

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

// ─── Page Switching ────────────────────────────────────────────

const VALID_MODES = ['chat', 'bgtasks', 'schedule', 'teams', 'proposals', 'audit'];

export function setMode(mode) {
  if (!VALID_MODES.includes(mode)) mode = 'chat';
  state.currentMode = mode;

  // Toggle nav buttons
  VALID_MODES.forEach(m => {
    const btn = document.getElementById(`btn-${m}`);
    if (btn) btn.classList.toggle('active', m === mode);
  });

  // Toggle view panels
  const viewMap = {
    chat: 'chat-view',
    bgtasks: 'bgtasks-view',
    schedule: 'schedule-view',
    teams: 'teams-view',
    proposals: 'proposals-view',
    audit: 'audit-view',
  };
  Object.entries(viewMap).forEach(([m, viewId]) => {
    const el = document.getElementById(viewId);
    if (el) el.style.display = m === mode ? 'flex' : 'none';
  });

  // Sidebar, main, and right panel only visible in chat mode
  const aside = document.querySelector('aside');
  const mainEl = document.querySelector('main');
  const rightPanel = document.getElementById('right-panel');
  if (aside) aside.style.display = mode === 'chat' ? '' : 'none';
  if (mainEl) mainEl.style.display = mode === 'chat' ? '' : 'none';
  if (rightPanel) rightPanel.style.display = mode === 'chat' ? '' : 'none';

  // Load data for the target page
  // These function references will be available on window.* during migration.
  // After full extraction, they'll be imported from page modules.
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
  if (mode === 'audit') {
    if (typeof window.loadAuditLog === 'function') window.loadAuditLog();
  }
}

// ─── Expose on window for HTML onclick handlers ────────────────
window.setMode = setMode;
window.toggleTheme = toggleTheme;
window.applyTheme = applyTheme;
window.getInitialTheme = getInitialTheme;
