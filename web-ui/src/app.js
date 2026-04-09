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

const VALID_MODES = ['chat', 'bgtasks', 'schedule', 'teams', 'proposals', 'audit', 'memory'];

function setMoreMenuOpen(open) {
  const menu = document.getElementById('more-menu');
  const btn = document.getElementById('btn-more');
  if (!menu || !btn) return;
  const next = !!open;
  menu.classList.toggle('open', next);
  btn.classList.toggle('active', next || state.currentMode === 'audit' || state.currentMode === 'memory');
  btn.setAttribute('aria-expanded', next ? 'true' : 'false');
}

export function toggleMoreMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('more-menu');
  setMoreMenuOpen(!(menu && menu.classList.contains('open')));
}

export function setMode(mode) {
  if (!VALID_MODES.includes(mode)) mode = 'chat';
  state.currentMode = mode;
  window.currentMode = mode;

  VALID_MODES.forEach((m) => {
    const btn = document.getElementById(`btn-${m}`);
    if (btn) btn.classList.toggle('active', m === mode);
  });
  const moreBtn = document.getElementById('btn-more');
  if (moreBtn) moreBtn.classList.toggle('active', mode === 'audit' || mode === 'memory');
  const auditItem = document.getElementById('btn-audit');
  if (auditItem) auditItem.classList.toggle('active', mode === 'audit');
  const memoryItem = document.getElementById('btn-memory');
  if (memoryItem) memoryItem.classList.toggle('active', mode === 'memory');
  setMoreMenuOpen(false);

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

  const aside = document.querySelector('aside');
  const mainEl = document.querySelector('main');
  const rightPanel = document.getElementById('right-panel');
  if (aside) aside.style.display = mode === 'chat' ? '' : 'none';
  if (mainEl) mainEl.style.display = mode === 'chat' ? '' : 'none';
  if (rightPanel) rightPanel.style.display = mode === 'chat' ? '' : 'none';

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

window.setMode = setMode;
window.toggleTheme = toggleTheme;
window.applyTheme = applyTheme;
window.getInitialTheme = getInitialTheme;
window.toggleMoreMenu = toggleMoreMenu;

document.addEventListener('click', (event) => {
  const menu = document.getElementById('more-menu');
  if (!menu) return;
  if (!menu.contains(event.target)) setMoreMenuOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setMoreMenuOpen(false);
});
