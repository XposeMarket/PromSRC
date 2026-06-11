/**
 * command-palette.js - Ctrl+K command palette.
 *
 * Quick-jump overlay for switching pages, opening recent chats, and
 * running a handful of common actions. Mirrors the Claude/Codex "Cmd+K"
 * pattern: type to filter, arrow keys to move, Enter to run, Esc to close.
 */

import { escHtml } from './utils.js';

const PAGE_ITEMS = [
  { id: 'page-chat', group: 'Pages', icon: '\u{1F4AC}', label: 'Chat', sub: 'Switch page', run: () => window.setMode?.('chat') },
  { id: 'page-bgtasks', group: 'Pages', icon: '\u{1F5C2}️', label: 'Background Tasks', sub: 'Switch page', run: () => window.setMode?.('bgtasks') },
  { id: 'page-schedule', group: 'Pages', icon: '\u{1F4C5}', label: 'Schedule', sub: 'Switch page', run: () => window.setMode?.('schedule') },
  { id: 'page-teams', group: 'Pages', icon: '\u{1F465}', label: 'Teams', sub: 'Switch page', run: () => window.setMode?.('teams') },
  { id: 'page-subagents', group: 'Pages', icon: '\u{1F916}', label: 'Subagents', sub: 'Switch page', run: () => window.setMode?.('subagents') },
  { id: 'page-proposals', group: 'Pages', icon: '\u{1F4DD}', label: 'Proposals', sub: 'Switch page', run: () => window.setMode?.('proposals') },
  { id: 'page-audit', group: 'Pages', icon: '\u{1F4CB}', label: 'Audit Log', sub: 'Switch page', run: () => window.setMode?.('audit') },
  { id: 'page-memory', group: 'Pages', icon: '\u{1F9E0}', label: 'Memory Graph', sub: 'Switch page', run: () => window.setMode?.('memory') },
  { id: 'page-hub', group: 'Pages', icon: '✨', label: 'Hub', sub: 'Switch page', run: () => window.setMode?.('hub') },
];

const ACTION_ITEMS = [
  { id: 'action-new-chat', group: 'Actions', icon: '➕', label: 'New Chat', sub: 'Start a new conversation', kbd: 'Ctrl+N', run: () => window.newChatSession?.() },
  { id: 'action-toggle-sidebar', group: 'Actions', icon: '☰', label: 'Toggle Sidebar', sub: 'Show or hide the left panel', run: () => window.toggleSidebar?.() },
  { id: 'action-toggle-theme', group: 'Actions', icon: '\u{1F3A8}', label: 'Toggle Theme', sub: 'Cycle the color theme', run: () => window.toggleTheme?.() },
  { id: 'action-shortcuts-help', group: 'Actions', icon: '⌨️', label: 'Keyboard Shortcuts', sub: 'Show all shortcuts', kbd: 'Ctrl+/', run: () => import('./shortcuts-help.js').then((m) => m.toggleShortcutsHelp()) },
];

// Human-readable names for #settings-panel-<tab> ids, used in the "sub" line
// of indexed settings results.
const SETTINGS_TAB_LABELS = {
  system: 'System', heartbeat: 'Heartbeat', search: 'Search', credentials: 'Credentials',
  security: 'Security', models: 'Models', agents: 'Agents', channels: 'Channels',
  integrations: 'Integrations', shortcuts: 'Shortcuts', pairing: 'Pairing', migration: 'Migration',
};

const MAX_RECENT_CHATS = 8;
const MAX_DEFAULT_PER_GROUP = 6;
const SKILLS_CACHE_TTL_MS = 60000;

let overlayEl = null;
let inputEl = null;
let resultsEl = null;
let activeIndex = 0;
let visibleItems = [];
let onKeyDownBound = null;
let skillsCache = [];
let skillsFetchedAt = 0;
let settingsIndexCache = null;

function getRecentChatItems() {
  const sessions = Array.isArray(window.chatSessions) ? window.chatSessions : [];
  return sessions.slice(0, MAX_RECENT_CHATS).map((s) => ({
    id: `session-${s.id}`,
    group: 'Recent Chats',
    icon: '\u{1F4AC}',
    label: s.title || s.preview || 'Untitled chat',
    sub: 'Open chat',
    run: () => window.openSession?.(s.id),
  }));
}

function getSkillItems() {
  return skillsCache.map((s) => ({
    id: `skill-${s.id}`,
    group: 'Skills',
    icon: '\u{1F9E9}',
    label: s.name || s.id,
    sub: s.description ? s.description.slice(0, 90) : 'Open skill',
    run: () => window.openHubSkillModal?.(s.id),
  }));
}

async function refreshSkillsCache() {
  const now = Date.now();
  if (skillsCache.length && now - skillsFetchedAt < SKILLS_CACHE_TTL_MS) return skillsCache;
  try {
    const r = await window.api?.('/api/hub/skills/usage?range=all');
    skillsCache = Array.isArray(r?.skills) ? r.skills : skillsCache;
    skillsFetchedAt = now;
  } catch { /* keep previous cache */ }
  return skillsCache;
}

// Scans the (always-present, just hidden) #settings-modal for labels and
// section headers so they can be searched and jumped to directly, without
// the user having to know which tab a setting lives in.
function buildSettingsIndex() {
  if (settingsIndexCache) return settingsIndexCache;
  const modal = document.getElementById('settings-modal');
  if (!modal) return [];

  const index = [];
  const seen = new Set();
  modal.querySelectorAll('[id^="settings-panel-"]').forEach((panel) => {
    const tab = panel.id.replace('settings-panel-', '');
    panel.querySelectorAll('label, .right-section-title').forEach((el) => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 3 || text.length > 70) return;
      const key = `${tab}:${text}`;
      if (seen.has(key)) return;
      seen.add(key);

      let target = el;
      if (el.tagName === 'LABEL') {
        target = el.querySelector('input,select,textarea,button') || el.nextElementSibling || el;
      }

      // Skip controls that live inside a conditionally-shown sub-section
      // (e.g. a per-channel-type form that's only revealed after picking
      // that channel type) - jumping to them would land on an invisible
      // element with nothing to highlight.
      let hidden = false;
      for (let anc = target; anc && anc !== panel; anc = anc.parentElement) {
        if (anc.style && anc.style.display === 'none') { hidden = true; break; }
      }
      if (hidden) return;

      index.push({ tab, label: text, target });
    });
  });
  settingsIndexCache = index;
  return index;
}

function getSettingsItems() {
  return buildSettingsIndex().map((entry, i) => ({
    id: `settings-${entry.tab}-${i}`,
    group: 'Settings',
    icon: '⚙️',
    label: entry.label,
    sub: `Settings → ${SETTINGS_TAB_LABELS[entry.tab] || entry.tab}`,
    run: () => openSettingsAndHighlight(entry.tab, entry.target),
  }));
}

function openSettingsAndHighlight(tab, target) {
  if (typeof window.openSettings === 'function') window.openSettings(tab);
  else if (typeof window.setSettingsTab === 'function') window.setSettingsTab(tab);

  setTimeout(() => {
    if (!target) return;
    // If the target itself is hidden (e.g. inside a collapsed section that
    // only the tab switch couldn't reveal), fall back to highlighting its
    // closest visible ancestor instead of silently doing nothing.
    let el = target;
    while (el && el.offsetParent === null && el.parentElement) el = el.parentElement;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('cmdk-highlight');
    setTimeout(() => el.classList.remove('cmdk-highlight'), 1600);
  }, 150);
}

function getAllItems() {
  return [...ACTION_ITEMS, ...PAGE_ITEMS, ...getRecentChatItems(), ...getSkillItems(), ...getSettingsItems()];
}

// Token-based scoring: every word in the query must appear somewhere in the
// item's label/sub text (so "heartbeat interval" matches a "Interval
// (minutes)" item whose sub-line is "Settings → Heartbeat").
function scoreItem(item, query) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const haystack = `${item.label || ''} ${item.sub || ''}`.toLowerCase();
  let score = 0;
  for (const tok of tokens) {
    const idx = haystack.indexOf(tok);
    if (idx === -1) return -1;
    score += idx === 0 ? 3 : 1;
  }
  return score;
}

function getFilteredItems(query) {
  const all = getAllItems();
  const trimmed = query.trim();
  if (!trimmed) {
    const byGroup = new Map();
    const out = [];
    for (const item of all) {
      // Settings entries are too granular/generic to be worth browsing
      // without a query; only surface them as search results.
      if (item.group === 'Settings') continue;
      const count = byGroup.get(item.group) || 0;
      if (count >= MAX_DEFAULT_PER_GROUP) continue;
      byGroup.set(item.group, count + 1);
      out.push(item);
    }
    return out;
  }
  return all
    .map((item) => ({ item, score: scoreItem(item, trimmed) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}

function ensureDom() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'cmdk-overlay';
  overlayEl.className = 'cmdk-overlay';
  overlayEl.style.display = 'none';
  overlayEl.innerHTML = `
    <div class="cmdk-card">
      <input id="cmdk-input" class="cmdk-input" type="text" placeholder="Search chats, pages, skills, settings..." autocomplete="off" spellcheck="false" />
      <div id="cmdk-results" class="cmdk-results"></div>
      <div class="cmdk-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>⏎</kbd> select</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>`;
  document.body.appendChild(overlayEl);

  inputEl = overlayEl.querySelector('#cmdk-input');
  resultsEl = overlayEl.querySelector('#cmdk-results');

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeCommandPalette();
  });
  inputEl.addEventListener('input', () => render(inputEl.value));
}

function render(query) {
  visibleItems = getFilteredItems(query);
  activeIndex = 0;

  if (!visibleItems.length) {
    resultsEl.innerHTML = '<div class="cmdk-empty">No matches</div>';
    return;
  }

  let html = '';
  let lastGroup = null;
  visibleItems.forEach((item, i) => {
    if (item.group !== lastGroup) {
      html += `<div class="cmdk-section-label">${escHtml(item.group)}</div>`;
      lastGroup = item.group;
    }
    html += `
      <div class="cmdk-item${i === activeIndex ? ' active' : ''}" data-index="${i}">
        <span class="cmdk-item-icon">${item.icon || ''}</span>
        <div class="cmdk-item-text">
          <div class="cmdk-item-label">${escHtml(item.label)}</div>
          ${item.sub ? `<div class="cmdk-item-sub">${escHtml(item.sub)}</div>` : ''}
        </div>
        ${item.kbd ? `<span class="cmdk-item-kbd">${escHtml(item.kbd)}</span>` : ''}
      </div>`;
  });
  resultsEl.innerHTML = html;

  resultsEl.querySelectorAll('.cmdk-item').forEach((el) => {
    el.addEventListener('mouseenter', () => setActive(Number(el.dataset.index)));
    el.addEventListener('click', () => runActive());
  });
}

function setActive(index) {
  if (!visibleItems.length) return;
  activeIndex = ((index % visibleItems.length) + visibleItems.length) % visibleItems.length;
  resultsEl.querySelectorAll('.cmdk-item').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.index) === activeIndex);
  });
  const activeEl = resultsEl.querySelector('.cmdk-item.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

function runActive() {
  const item = visibleItems[activeIndex];
  if (!item) return;
  closeCommandPalette();
  item.run?.();
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeCommandPalette();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    setActive(activeIndex + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setActive(activeIndex - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    runActive();
  }
}

export function openCommandPalette() {
  ensureDom();
  render('');
  inputEl.value = '';
  overlayEl.style.display = 'flex';
  inputEl.focus();
  onKeyDownBound = onKeyDown;
  document.addEventListener('keydown', onKeyDownBound, true);

  refreshSkillsCache().then(() => {
    if (overlayEl.style.display !== 'none') render(inputEl.value);
  });
}

export function closeCommandPalette() {
  if (!overlayEl || overlayEl.style.display === 'none') return;
  overlayEl.style.display = 'none';
  if (onKeyDownBound) {
    document.removeEventListener('keydown', onKeyDownBound, true);
    onKeyDownBound = null;
  }
}

export function toggleCommandPalette() {
  if (overlayEl && overlayEl.style.display !== 'none') closeCommandPalette();
  else openCommandPalette();
}

window.openCommandPalette = openCommandPalette;
window.closeCommandPalette = closeCommandPalette;
