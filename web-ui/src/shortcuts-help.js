/**
 * shortcuts-help.js - "Keyboard Shortcuts" overlay (Ctrl+/).
 *
 * Static reference list of the global shortcuts registered in shortcuts.js
 * and command-palette.js. Dismiss with Esc, click-outside, or Ctrl+/ again.
 */

import { escHtml } from './utils.js';

const GROUPS = [
  {
    title: 'General',
    items: [
      { combo: 'Ctrl + N', desc: 'New chat' },
      { combo: 'Ctrl + K', desc: 'Open command palette (search chats, pages, actions)' },
      { combo: 'Ctrl + /', desc: 'Show this shortcuts list' },
      { combo: 'Esc', desc: 'Close dialogs and overlays' },
    ],
  },
  {
    title: 'Command Palette',
    items: [
      { combo: '↑ / ↓', desc: 'Move selection' },
      { combo: 'Enter', desc: 'Run selected item' },
      { combo: 'Esc', desc: 'Close palette' },
    ],
  },
];

let overlayEl = null;
let onKeyDownBound = null;

function ensureDom() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'shortcuts-help-overlay';
  overlayEl.className = 'cmdk-overlay';
  overlayEl.style.display = 'none';

  const groupsHtml = GROUPS.map((group) => `
    <div class="shortcuts-help-group">
      <div class="shortcuts-help-group-title">${escHtml(group.title)}</div>
      ${group.items.map((item) => `
        <div class="shortcuts-help-row">
          <span class="shortcuts-help-desc">${escHtml(item.desc)}</span>
          <span class="shortcuts-help-combo">${item.combo
            .split(/\s*\+\s*/)
            .map((k) => `<kbd>${escHtml(k)}</kbd>`)
            .join('<span class="shortcuts-help-plus">+</span>')}</span>
        </div>`).join('')}
    </div>`).join('');

  overlayEl.innerHTML = `
    <div class="cmdk-card shortcuts-help-card">
      <div class="shortcuts-help-header">
        <div class="shortcuts-help-title">Keyboard Shortcuts</div>
        <button class="shortcuts-help-close" type="button" aria-label="Close">✕</button>
      </div>
      <div class="shortcuts-help-body">${groupsHtml}</div>
    </div>`;
  document.body.appendChild(overlayEl);

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeShortcutsHelp();
  });
  overlayEl.querySelector('.shortcuts-help-close').addEventListener('click', closeShortcutsHelp);
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeShortcutsHelp();
  }
}

export function openShortcutsHelp() {
  ensureDom();
  overlayEl.style.display = 'flex';
  onKeyDownBound = onKeyDown;
  document.addEventListener('keydown', onKeyDownBound, true);
}

export function closeShortcutsHelp() {
  if (!overlayEl || overlayEl.style.display === 'none') return;
  overlayEl.style.display = 'none';
  if (onKeyDownBound) {
    document.removeEventListener('keydown', onKeyDownBound, true);
    onKeyDownBound = null;
  }
}

export function toggleShortcutsHelp() {
  if (overlayEl && overlayEl.style.display !== 'none') closeShortcutsHelp();
  else openShortcutsHelp();
}

window.openShortcutsHelp = openShortcutsHelp;
window.closeShortcutsHelp = closeShortcutsHelp;
