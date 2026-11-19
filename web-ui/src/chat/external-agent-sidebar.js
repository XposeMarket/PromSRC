// Harness-aware chat list (desktop sidebar + mobile drawer).
//
// - Projects: after the last Prometheus project, one collapsible section per
//   connected harness (Codex, Claude Code, ...) listing that harness's own
//   folders/projects and the chats Prometheus runs there.
// - Chats: an "Agents" filter button at the bottom of the list. Any mix of
//   Prometheus and harnesses can be shown (multi-select, never empty).
//
// Rendering of individual chat rows stays with each surface (the caller passes
// its own row renderer), so rows look exactly like every other chat.
import {
  agentName, esc, externalAgentRequest, getAgentChoice, loadAgentFolders, loadExternalAgents, onExternalAgentsChange, selectableAgents,
  setAgentChoice, setExternalAgentRequest,
} from './external-agent-ui.js';
import { agentLogoHtml } from './external-agent-logos.js';

const ORDER = ['prometheus', 'codex', 'claude-code', 'hermes', 'openclaw', 'cursor'];
const FILTER_KEY = 'prometheus_harness_chat_filter';
const OPEN_KEY = 'prometheus_harness_sections_open';
const IMPORT_AGENT = {
  codex: 'codex', 'codex-local': 'codex', openai_codex: 'codex', claude: 'claude-code', 'claude-code': 'claude-code',
  'claude-code-local': 'claude-code', hermes: 'hermes', 'hermes-local': 'hermes', openclaw: 'openclaw', 'openclaw-local': 'openclaw',
  cursor: 'cursor', 'cursor-local': 'cursor',
};

function readJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const st = {
  map: {}, mapKey: '', loadedAt: 0, loading: null,
  filter: (() => { const v = readJson(FILTER_KEY, null); return Array.isArray(v) && v.length ? new Set(v) : null; })(),
  open: new Set(readJson(OPEN_KEY, [])),
  listeners: new Set(), menu: null, scrim: null, surface: 'desktop', hooks: {}, wired: false,
};

function notify() { for (const fn of st.listeners) { try { fn(); } catch { /* UI only */ } } }
export function onHarnessSidebarChange(fn) { st.listeners.add(fn); return () => st.listeners.delete(fn); }

/** Session id -> { agentId, cwd, title, at, imported }. Cheap; refreshed at most every 10 s. */
export function refreshHarnessSessionMap(force = false) {
  if (!force && (st.loading || Date.now() - st.loadedAt < 10_000)) return st.loading || Promise.resolve(st.map);
  st.loading = externalAgentRequest('/api/external-agents/session-map').then((data) => {
    const map = data?.sessions && typeof data.sessions === 'object' ? data.sessions : {};
    const key = JSON.stringify(map);
    st.map = map; st.loadedAt = Date.now();
    if (key !== st.mapKey) { st.mapKey = key; notify(); }
    return st.map;
  }).catch(() => { st.loadedAt = Date.now(); return st.map; }).finally(() => { st.loading = null; });
  return st.loading;
}

export function harnessOfSession(session) {
  const id = String(session?.id || '');
  const bound = session?.externalAgent?.agentId || st.map[id]?.agentId;
  if (bound) return String(bound);
  const src = session?.externalImport?.source || session?.externalImport || {};
  const key = [src.adapter, src.provider].map((v) => String(v || '').trim().toLowerCase()).find((v) => IMPORT_AGENT[v]);
  return key ? IMPORT_AGENT[key] : 'prometheus';
}

export function isHarnessFilterActive() { return !!st.filter; }
export function isHarnessVisible(agentId) { return !st.filter || st.filter.has(agentId); }
export function isSessionVisibleForHarnessFilter(session) {
  if (!st.filter) return true;
  void refreshHarnessSessionMap();
  return st.filter.has(harnessOfSession(session));
}

function knownHarnesses() {
  const ids = new Set(selectableAgents().map((a) => a.id));
  for (const entry of Object.values(st.map)) if (entry?.agentId) ids.add(entry.agentId);
  return [...ids].sort((a, b) => (ORDER.indexOf(a) + 99) % 99 - (ORDER.indexOf(b) + 99) % 99);
}

function normPath(p) { return String(p || '').replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase(); }
function baseName(p) { const parts = String(p || '').split(/[\\/]/).filter(Boolean); return parts[parts.length - 1] || String(p || ''); }
// Short, quiet names: "Folder: C:\\a\\b\\repo" -> "repo". Real project names are kept.
function shortLabel(label, path) {
  const text = String(label || '').replace(/^(folder|project)\s*:\s*/i, '').trim();
  if (!text || /[\\/]/.test(text)) return baseName(path || text) || 'Folder';
  return text;
}

function harnessGroups() {
  void refreshHarnessSessionMap();
  return knownHarnesses().filter(isHarnessVisible).map((id) => {
    const folders = new Map();
    for (const f of cachedFolders(id)) if (f?.path) folders.set(normPath(f.path), { key: normPath(f.path), path: f.path, label: shortLabel(f.label, f.path), chats: [] });
    for (const [sid, entry] of Object.entries(st.map)) {
      if (entry?.agentId !== id) continue;
      const key = entry.cwd ? normPath(entry.cwd) : '~imported';
      if (!folders.has(key)) folders.set(key, { key, path: entry.cwd || '', label: entry.cwd ? baseName(entry.cwd) : 'Imported chats', chats: [] });
      folders.get(key).chats.push({ id: sid, title: entry.title, at: entry.at });
    }
    const list = [...folders.values()];
    list.forEach((f) => f.chats.sort((a, b) => b.at - a.at));
    list.sort((a, b) => (b.chats[0]?.at || 0) - (a.chats[0]?.at || 0));
    return { id, name: agentName(id), folders: list, chatCount: list.reduce((n, f) => n + f.chats.length, 0) };
  });
}

const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
const FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l1.7 2h7.3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 9.5h17"/></svg>';

/**
 * Harness sections for the Projects list. `chatRow({ id, title, lastMessageAt })`
 * returns the surface's own chat row HTML. Empty string when no harness is on.
 */
export function harnessProjectsHtml({ chatRow, surface = 'desktop' } = {}) {
  const groups = harnessGroups();
  if (!groups.length) return '';
  return `<div class="ea-harness-projects ea-harness-${surface}">${groups.map((g) => {
    const hKey = `h:${g.id}`;
    const hOpen = st.open.has(hKey);
    const folders = !hOpen ? '' : (g.folders.length ? g.folders.map((f) => {
      const fKey = `f:${g.id}|${f.key}`;
      const fOpen = st.open.has(fKey);
      const rows = fOpen ? (f.chats.length
        ? f.chats.map((c) => chatRow({ id: c.id, title: c.title, lastMessageAt: c.at })).join('')
        : '<div class="ea-harness-empty">No chats yet</div>') : '';
      return `<div class="ea-harness-folder${fOpen ? ' is-open' : ''}">
        <div class="ea-harness-folder-row">
          <button type="button" class="ea-harness-folder-btn" data-ea-harness-toggle="${esc(fKey)}" aria-expanded="${fOpen}" title="${esc(f.path || f.label)}">
            <span class="ea-harness-chev">${CHEVRON}</span><span class="ea-harness-folder-icon">${FOLDER}</span><span class="ea-harness-label">${esc(f.label)}</span>${f.chats.length ? `<span class="ea-harness-count">${f.chats.length}</span>` : ''}</button>
          ${f.path ? `<button type="button" class="ea-harness-new" data-ea-harness-new="${esc(g.id)}" data-path="${esc(f.path)}" data-label="${esc(f.label)}" title="New ${esc(g.name)} chat in ${esc(f.label)}" aria-label="New ${esc(g.name)} chat in ${esc(f.label)}">+</button>` : ''}
        </div>
        ${fOpen ? `<div class="ea-harness-chats">${rows}</div>` : ''}
      </div>`;
    }).join('') : '<div class="ea-harness-empty">No projects found</div>');
    return `<div class="ea-harness-group${hOpen ? ' is-open' : ''}" data-ea-harness="${esc(g.id)}">
      <button type="button" class="ea-harness-head" data-ea-harness-toggle="${esc(hKey)}" aria-expanded="${hOpen}">
        <span class="ea-harness-chev">${CHEVRON}</span>${agentLogoHtml(g.id)}<span class="ea-harness-label">${esc(g.name)}</span>${g.chatCount ? `<span class="ea-harness-count">${g.chatCount}</span>` : ''}</button>
      ${hOpen ? `<div class="ea-harness-folders">${folders}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

// ---- Agents filter (bottom of the chat list) --------------------------------
function allFilterIds() { return ['prometheus', ...knownHarnesses()]; }

/** "Agents" button for the bottom of the chat list; empty when no harness exists. */
export function harnessFilterButtonHtml() {
  void refreshHarnessSessionMap();
  const ids = allFilterIds();
  if (ids.length < 2) return '';
  const shown = ids.filter(isHarnessVisible);
  const label = !st.filter ? 'All agents' : shown.length === 1 ? agentName(shown[0]) : `${shown.length} agents`;
  return `<button type="button" class="ea-harness-filter-btn${st.filter ? ' is-filtered' : ''}" data-ea-harness-filter aria-haspopup="dialog" title="Choose whose chats to show">
    <span class="ea-harness-filter-logos">${shown.slice(0, 4).map((id) => agentLogoHtml(id)).join('')}</span><span class="ea-harness-filter-label">${esc(label)}</span><span class="ea-caret" aria-hidden="true">▾</span></button>`;
}

function setFilter(next) {
  const all = allFilterIds();
  st.filter = next && next.size && next.size < all.length ? next : null;
  writeJson(FILTER_KEY, st.filter ? [...st.filter] : null);
  notify();
}

function toggleFilter(id) {
  const next = new Set(st.filter || allFilterIds());
  if (next.has(id)) {
    if (next.size === 1) return; // never an empty list
    next.delete(id);
  } else next.add(id);
  setFilter(next);
}

function filterMenuInner() {
  return `${st.surface === 'mobile' ? '<div class="ea-sheet-handle"></div>' : ''}<h3 class="ea-sheet-title ea-filter-title">Show chats from</h3>
    ${allFilterIds().map((id) => {
      const on = isHarnessVisible(id);
      return `<button type="button" class="ea-menu-item ea-filter-item${on ? ' is-active' : ''}" data-ea-filter-toggle="${esc(id)}" role="menuitemcheckbox" aria-checked="${on}">
        ${agentLogoHtml(id)}<span class="ea-filter-name">${esc(agentName(id))}</span><span class="ea-filter-box" aria-hidden="true">${on ? '✓' : ''}</span></button>`;
    }).join('')}
    ${st.filter ? '<button type="button" class="ea-menu-item ea-filter-all" data-ea-filter-all>Show all</button>' : ''}`;
}

function closeFilterMenu() {
  st.menu?.remove();
  st.scrim?.remove();
  st.menu = null;
  st.scrim = null;
}

function openFilterMenu(anchor) {
  closeFilterMenu();
  const mobile = st.surface === 'mobile';
  st.scrim = document.createElement('button');
  st.scrim.type = 'button';
  st.scrim.className = mobile ? 'ea-sheet-scrim' : 'ea-filter-scrim';
  st.scrim.setAttribute('aria-label', 'Close');
  st.scrim.addEventListener('click', (event) => { event.stopPropagation(); closeFilterMenu(); });
  st.menu = document.createElement('section');
  st.menu.className = mobile ? 'ea-sheet ea-filter-sheet' : 'ea-menu ea-filter-menu';
  st.menu.setAttribute('role', 'dialog');
  st.menu.setAttribute('aria-label', 'Show chats from');
  st.menu.innerHTML = filterMenuInner();
  document.body.append(st.scrim, st.menu);
  if (!mobile && anchor) {
    const r = anchor.getBoundingClientRect();
    Object.assign(st.menu.style, { position: 'fixed', left: `${Math.max(8, r.left)}px`, bottom: `${Math.max(8, window.innerHeight - r.top + 6)}px`, top: 'auto' });
  }
  st.menu.addEventListener('click', (event) => {
    event.stopPropagation();
    const t = event.target.closest('[data-ea-filter-toggle]');
    if (t) { toggleFilter(t.getAttribute('data-ea-filter-toggle')); if (st.menu) st.menu.innerHTML = filterMenuInner(); return; }
    if (event.target.closest('[data-ea-filter-all]')) { setFilter(null); closeFilterMenu(); }
  });
}

// ---- Folder for a harness chat: the existing Chat/Project picker -------------
// When a harness runs the new chat, the Chat/Project popover lists THAT
// harness's projects/folders (its own history) instead of Prometheus projects.
const folderCache = new Map();
function cachedFolders(id) {
  if (!folderCache.has(id)) {
    folderCache.set(id, []);
    loadAgentFolders(id).then((list) => { folderCache.set(id, Array.isArray(list) ? list : []); notify(); }).catch(() => {});
  }
  return folderCache.get(id);
}

function folderLabelFor(choice) {
  if (!choice.cwd) return 'Default folder';
  const hit = cachedFolders(choice.id).find((f) => normPath(f.path) === normPath(choice.cwd));
  return shortLabel(hit?.label, choice.cwd);
}

function overrideLabel(el, text) {
  if (!el) return;
  if (text) {
    if (el.dataset.eaNative === undefined) el.dataset.eaNative = el.textContent;
    if (el.textContent !== text) el.textContent = text;
  } else if (el.dataset.eaNative !== undefined) {
    const native = el.dataset.eaNative;
    delete el.dataset.eaNative;
    if (el.textContent !== native) el.textContent = native;
  }
}

function folderRowsHtml(id, choice) {
  const options = [{ path: '', label: 'Default folder' }, ...cachedFolders(id).filter((f) => f?.path)];
  return `<div class="ea-folder-list">
    <div class="ea-folder-title">${agentLogoHtml(id)}<span>${esc(agentName(id))} projects</span></div>
    ${options.map((f) => {
      const selected = normPath(f.path) === normPath(choice.cwd);
      return `<button type="button" class="ea-folder-option${selected ? ' is-active' : ''}" data-ea-folder-path="${esc(f.path)}" aria-selected="${selected}" title="${esc(f.path || 'The chat project folder, or the Prometheus workspace')}">
        <span class="ea-harness-folder-icon">${FOLDER}</span><span class="ea-folder-name">${esc(f.path ? shortLabel(f.label, f.path) : f.label)}</span><span class="ea-folder-check" aria-hidden="true">${selected ? '✓' : ''}</span></button>`;
    }).join('')}
  </div>`;
}

function decoratePopover(pop, nativeChatSelector, choice) {
  const mine = pop.querySelector(':scope > .ea-folder-list');
  if (choice.id === 'prometheus') {
    if (mine) mine.remove();
    pop.classList.remove('ea-folder-mode');
    return;
  }
  // Harness projects never depend on Prometheus projects loading.
  const nativeChat = pop.querySelector(nativeChatSelector);
  const key = `${choice.id}|${normPath(choice.cwd)}|${cachedFolders(choice.id).length}`;
  if (mine && mine.dataset.key === key) return;
  mine?.remove();
  pop.classList.add('ea-folder-mode');
  pop.insertAdjacentHTML('beforeend', folderRowsHtml(choice.id, choice));
  const list = pop.querySelector(':scope > .ea-folder-list');
  list.dataset.key = key;
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ea-folder-path]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    setAgentChoice(choice.id, button.getAttribute('data-ea-folder-path') || '');
    // The native "Chat" option clears any Prometheus project and closes the popover.
    const chatOption = pop.querySelector(nativeChatSelector);
    if (chatOption) chatOption.click();
    else if (typeof window.closeDesktopNewChatContextPopover === 'function' && pop.id === 'chat-new-context-popover') window.closeDesktopNewChatContextPopover();
    else document.querySelector('.pm-chat-target-popover-scrim')?.click();
    syncFolderUi();
  });
}

function syncFolderUi() {
  const choice = getAgentChoice();
  document.body?.classList.toggle('ea-folder-choice', choice.id !== 'prometheus');
  const text = choice.id !== 'prometheus' ? folderLabelFor(choice) : '';
  overrideLabel(document.getElementById('chat-new-context-label'), text);
  overrideLabel(document.querySelector('#pm-new-chat-project .pm-new-chat-context-value strong'), text);
  const desktopPop = document.getElementById('chat-new-context-popover');
  if (desktopPop && !desktopPop.hidden && desktopPop.dataset.mode === 'projects') decoratePopover(desktopPop, '[data-desktop-project-id=""]', choice);
  const mobilePop = document.querySelector('.pm-new-chat-context-popover[data-popover-type="project"]');
  if (mobilePop) decoratePopover(mobilePop, '[data-project-id=""]', choice);
}

// ---- Wiring ------------------------------------------------------------------
async function startHarnessChat(id, path) {
  closeFilterMenu();
  try { await st.hooks.newChat?.(); } catch { /* the new-chat page still opens */ }
  setAgentChoice(id, path);
  // The new-chat page can mount a moment later; re-apply once it has.
  setTimeout(() => { const c = getAgentChoice(); if (c.id !== id || c.cwd !== path) setAgentChoice(id, path); }, 350);
}

function onDocClick(event) {
  const target = event.target;
  if (!target?.closest) return;
  const toggle = target.closest('[data-ea-harness-toggle]');
  if (toggle) {
    event.preventDefault();
    event.stopPropagation();
    const key = toggle.getAttribute('data-ea-harness-toggle');
    if (st.open.has(key)) st.open.delete(key); else st.open.add(key);
    writeJson(OPEN_KEY, [...st.open]);
    notify();
    return;
  }
  if (target.closest('#chat-new-context-trigger, #pm-new-chat-project')) { setTimeout(syncFolderUi, 0); setTimeout(syncFolderUi, 80); }
  const add = target.closest('[data-ea-harness-new]');
  if (add) {
    event.preventDefault();
    event.stopPropagation();
    void startHarnessChat(add.getAttribute('data-ea-harness-new'), add.getAttribute('data-path') || '');
    return;
  }
  const filter = target.closest('[data-ea-harness-filter]');
  if (filter) {
    event.preventDefault();
    event.stopPropagation();
    openFilterMenu(filter);
  }
}

/**
 * Start the sidebar integration once per surface.
 * - request: JSON fetch helper (mobile gateway fetch); desktop uses window.api.
 * - rerender: redraw the surface's chat list (called on any change).
 * - newChat: open a fresh new-chat page.
 */
export function initHarnessSidebar({ surface = 'desktop', request, rerender, newChat } = {}) {
  st.surface = surface;
  if (request) setExternalAgentRequest(request);
  st.hooks = { rerender, newChat };
  // Read by the legacy desktop sidebar (window keeps that file module-free of this one).
  window.__promHarnessSidebar = {
    visible: isSessionVisibleForHarnessFilter,
    isVisible: isHarnessVisible,
    projectsHtml: (opts) => harnessProjectsHtml({ surface, ...opts }),
    filterButtonHtml: harnessFilterButtonHtml,
  };
  if (!st.wired) {
    st.wired = true;
    document.addEventListener('click', onDocClick, true);
    setInterval(syncFolderUi, 400);
    onExternalAgentsChange(notify);
    onHarnessSidebarChange(() => { try { st.hooks.rerender?.(); } catch { /* UI only */ } });
  }
  void loadExternalAgents();
  void refreshHarnessSessionMap(true);
}

// ---- Mobile: the Chat/Project chip is a native picker --------------------------
const FOLDER_PREFIX = '__ea_folder__:';

/** Options for the native Chat/Project picker while a harness runs the new chat, else null. */
export function harnessFolderPickerOptions() {
  const choice = getAgentChoice();
  if (choice.id === 'prometheus') return null;
  const options = [{ path: '', label: 'Default folder' }, ...cachedFolders(choice.id).filter((f) => f?.path)];
  return options.map((f) => ({
    value: FOLDER_PREFIX + f.path,
    label: f.path ? shortLabel(f.label, f.path) : f.label,
    selected: normPath(f.path) === normPath(choice.cwd),
  }));
}

/** Handle a native picker value; returns true when it was a harness folder. */
export function pickHarnessFolderOption(value) {
  const text = String(value || '');
  if (!text.startsWith(FOLDER_PREFIX)) return false;
  const choice = getAgentChoice();
  if (choice.id === 'prometheus') return true;
  setAgentChoice(choice.id, text.slice(FOLDER_PREFIX.length));
  syncFolderUi();
  return true;
}
