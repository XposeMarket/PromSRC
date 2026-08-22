const MULTI_CHAT_STORAGE_KEY = 'prometheus_multi_chat_tabs_v1';
const DRAG_MIME = 'application/x-prometheus-chat';
const EMBED_PARAM = 'multiChatPane';
const SESSION_PARAM = 'multiChatSession';
const MAX_TABS = 30;

let state = {
  tabs: [],
  mainSessionId: '',
  sideSessionId: '',
  sourceSessionId: '',
};
let installed = false;
let dragPayload = null;
let observer = null;
let activeSessionPoll = null;
let pendingDrawerOpen = false;

function clean(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return clean(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isEmbeddedSidePane() {
  try { return new URLSearchParams(location.search).get(EMBED_PARAM) === 'side'; } catch { return false; }
}

function ensureStylesheet() {
  if (document.querySelector('link[data-prom-multi-chat-style="1"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.dataset.promMultiChatStyle = '1';
  link.href = new URL('../../styles/multi-chat-workspace.css', import.meta.url).href;
  document.head.appendChild(link);
}

function readStoredState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MULTI_CHAT_STORAGE_KEY) || '{}');
    const tabs = Array.isArray(parsed?.tabs) ? parsed.tabs : [];
    state.tabs = tabs
      .map((tab) => ({ sessionId: clean(tab?.sessionId), title: clean(tab?.title) || 'Chat' }))
      .filter((tab) => tab.sessionId)
      .filter((tab, index, all) => all.findIndex((candidate) => candidate.sessionId === tab.sessionId) === index)
      .slice(-MAX_TABS);
    state.sideSessionId = clean(parsed?.sideSessionId);
    state.sourceSessionId = clean(parsed?.sourceSessionId);
  } catch {}
}

function persistState() {
  try {
    localStorage.setItem(MULTI_CHAT_STORAGE_KEY, JSON.stringify({
      tabs: state.tabs.slice(-MAX_TABS),
      sideSessionId: state.sideSessionId,
      sourceSessionId: state.sourceSessionId,
    }));
  } catch {}
}

function sessionRecords() {
  const direct = Array.isArray(window.chatSessions) ? window.chatSessions : [];
  const stateRecords = Array.isArray(window.state?.chatSessions) ? window.state.chatSessions : [];
  const all = [...direct, ...stateRecords];
  try {
    const stored = JSON.parse(localStorage.getItem('prometheus_chat_sessions_v1') || '[]');
    if (Array.isArray(stored)) all.push(...stored);
  } catch {}
  return all;
}

function recordSessionId(record) {
  return clean(record?.sessionId || record?.id || record?.session_id);
}

function recordTitle(record) {
  return clean(record?.title || record?.name || record?.label || record?.summary || 'Chat');
}

function titleForSession(sessionId, fallback = '') {
  const sid = clean(sessionId);
  const record = sessionRecords().find((candidate) => recordSessionId(candidate) === sid);
  if (record) return recordTitle(record);
  const row = findSidebarRow(sid);
  const rowTitle = clean(row?.querySelector?.('.job-item-title, .chat-session-title, [data-session-title]')?.textContent || row?.textContent);
  return rowTitle || clean(fallback) || 'Chat';
}

function currentMainSessionId() {
  return clean(window.activeChatSessionId || window.state?.activeChatSessionId || window.agentSessionId);
}

function extractSessionFromRow(row) {
  if (!row) return '';
  for (const value of [
    row.dataset?.sessionId,
    row.dataset?.chatSessionId,
    row.dataset?.session,
    row.dataset?.id,
  ]) {
    if (clean(value)) return clean(value);
  }
  const onclick = clean(row.getAttribute?.('onclick'));
  const match = onclick.match(/(?:open|select|switch|load)[A-Za-z]*Chat[A-Za-z]*\s*\(\s*['"]([^'"]+)['"]/i)
    || onclick.match(/(?:open|select|switch|load)[A-Za-z]*Session[A-Za-z]*\s*\(\s*['"]([^'"]+)['"]/i);
  return clean(match?.[1]);
}

function sidebarRows() {
  return Array.from(document.querySelectorAll('.chat-session-item, #sessions-list .job-item, #channels-list .chat-session-item'));
}

function findSidebarRow(sessionId) {
  const sid = clean(sessionId);
  if (!sid) return null;
  return sidebarRows().find((row) => extractSessionFromRow(row) === sid) || null;
}

function normalizePayload(raw) {
  const sessionId = clean(raw?.sessionId || raw?.id);
  if (!sessionId) return null;
  return { sessionId, title: clean(raw?.title) || titleForSession(sessionId) };
}

function payloadFromEvent(event) {
  if (dragPayload) return dragPayload;
  try {
    const raw = event.dataTransfer?.getData(DRAG_MIME) || event.dataTransfer?.getData('text/plain');
    if (!raw) return null;
    const parsed = raw.startsWith('{') ? JSON.parse(raw) : { sessionId: raw };
    return normalizePayload(parsed);
  } catch { return null; }
}

function addTab(sessionId, title = '') {
  const sid = clean(sessionId);
  if (!sid) return;
  const existing = state.tabs.find((tab) => tab.sessionId === sid);
  if (existing) existing.title = clean(title) || existing.title || titleForSession(sid);
  else state.tabs.push({ sessionId: sid, title: clean(title) || titleForSession(sid) });
  if (state.tabs.length > MAX_TABS) state.tabs.splice(0, state.tabs.length - MAX_TABS);
  persistState();
}

function removeTab(sessionId) {
  const sid = clean(sessionId);
  if (!sid) return;
  state.tabs = state.tabs.filter((tab) => tab.sessionId !== sid);
  if (state.sideSessionId === sid) state.sideSessionId = '';
  if (state.sourceSessionId === sid) state.sourceSessionId = '';
  persistState();
  render();
}

function callNativeSessionSwitcher(sessionId) {
  const sid = clean(sessionId);
  if (!sid) return false;
  const row = findSidebarRow(sid);
  if (row) {
    row.click();
    return true;
  }
  for (const name of ['openChatSession', 'selectChatSession', 'switchChatSession', 'loadChatSession', 'openSession']) {
    if (typeof window[name] === 'function') {
      try { window[name](sid); return true; } catch {}
    }
  }
  try {
    window.dispatchEvent(new CustomEvent('prometheus:open-chat-session', { detail: { sessionId: sid, source: 'multi-chat' } }));
    return true;
  } catch { return false; }
}

function activateMain(sessionId, title = '') {
  const sid = clean(sessionId);
  if (!sid) return;
  const previous = currentMainSessionId();
  if (previous) addTab(previous, titleForSession(previous));
  addTab(sid, title);
  state.mainSessionId = sid;
  callNativeSessionSwitcher(sid);
  persistState();
  render();
}

function sideFrameUrl(sessionId) {
  const url = new URL(location.href);
  url.searchParams.set('desktop', '1');
  url.searchParams.set(EMBED_PARAM, 'side');
  url.searchParams.set(SESSION_PARAM, clean(sessionId));
  url.hash = '';
  return url.toString();
}

function openSide(sessionId, title = '') {
  const sid = clean(sessionId);
  if (!sid) return;
  if (sid === currentMainSessionId()) return;
  addTab(sid, title);
  state.sideSessionId = sid;
  persistState();
  render();
}

function closeSide() {
  state.sideSessionId = '';
  persistState();
  render();
}

function reorderTabs(draggedId, targetId) {
  const from = state.tabs.findIndex((tab) => tab.sessionId === clean(draggedId));
  const to = state.tabs.findIndex((tab) => tab.sessionId === clean(targetId));
  if (from < 0 || to < 0 || from === to) return;
  const [tab] = state.tabs.splice(from, 1);
  state.tabs.splice(to, 0, tab);
  persistState();
  renderTabStrip();
}

function ensureTabStrip() {
  let strip = document.getElementById('prom-multi-chat-tabs');
  if (strip) return strip;
  const chatView = document.getElementById('chat-view');
  if (!chatView) return null;
  strip = document.createElement('div');
  strip.id = 'prom-multi-chat-tabs';
  strip.className = 'prom-multi-chat-tabs';
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', 'Open chats');
  chatView.prepend(strip);
  return strip;
}

function renderTabStrip() {
  const strip = ensureTabStrip();
  if (!strip) return;
  const mainId = currentMainSessionId();
  if (mainId) addTab(mainId, titleForSession(mainId));
  state.mainSessionId = mainId;
  strip.innerHTML = state.tabs.map((tab) => {
    const isMain = tab.sessionId === mainId;
    const isSide = tab.sessionId === state.sideSessionId;
    const role = isMain ? 'Main chat' : isSide ? 'Side chat' : 'Chat';
    return `<div class="prom-multi-chat-tab${isMain ? ' is-main' : ''}${isSide ? ' is-side' : ''}" draggable="true" role="tab" aria-selected="${isMain ? 'true' : 'false'}" data-session-id="${escapeHtml(tab.sessionId)}" title="${escapeHtml(tab.title)}">
      <button type="button" class="prom-multi-chat-tab-open" data-tab-open="${escapeHtml(tab.sessionId)}"><span class="prom-multi-chat-tab-role">${role}</span><span class="prom-multi-chat-tab-title">${escapeHtml(tab.title)}</span></button>
      <button type="button" class="prom-multi-chat-tab-close" data-tab-close="${escapeHtml(tab.sessionId)}" aria-label="Close ${escapeHtml(tab.title)} tab" title="Close tab">×</button>
    </div>`;
  }).join('');
  strip.hidden = state.tabs.length < 2 && !state.sideSessionId;
}

function ensureSidePane() {
  let pane = document.getElementById('prom-multi-chat-side-pane');
  const chatView = document.getElementById('chat-view');
  if (!chatView) return null;
  if (!pane) {
    pane = document.createElement('section');
    pane.id = 'prom-multi-chat-side-pane';
    pane.className = 'prom-multi-chat-side-pane';
    pane.innerHTML = '<header class="prom-multi-chat-side-header"><div><span class="prom-multi-chat-side-kicker">SIDE CHAT</span><strong id="prom-multi-chat-side-title">Chat</strong></div><button type="button" id="prom-multi-chat-side-close" aria-label="Close side chat" title="Close side chat">×</button></header><iframe id="prom-multi-chat-side-frame" title="Side chat"></iframe>';
    chatView.appendChild(pane);
  }
  return pane;
}

function renderSidePane() {
  const pane = ensureSidePane();
  if (!pane) return;
  const sid = clean(state.sideSessionId);
  document.body.classList.toggle('prom-multi-chat-side-open', Boolean(sid));
  pane.hidden = !sid;
  if (!sid) return;
  const title = titleForSession(sid);
  const titleEl = pane.querySelector('#prom-multi-chat-side-title');
  if (titleEl) titleEl.textContent = title;
  const frame = pane.querySelector('#prom-multi-chat-side-frame');
  const wanted = sideFrameUrl(sid);
  if (frame && frame.dataset.sessionId !== sid) {
    frame.dataset.sessionId = sid;
    frame.src = wanted;
  }
}

function allSourceTabs() {
  const main = currentMainSessionId();
  if (main) addTab(main, titleForSession(main));
  return state.tabs.slice();
}

function showSourceSelector({ openDrawerAfter = false } = {}) {
  const panel = document.getElementById('sources-minimized-panel');
  const tabs = allSourceTabs();
  if (!panel || tabs.length < 2) return false;
  pendingDrawerOpen = openDrawerAfter;
  panel.hidden = false;
  panel.classList.add('prom-source-chat-selector');
  document.body.classList.add('sources-minimized-open');
  try { window.syncSourcesMinimizedLayout?.(true); } catch {}
  panel.innerHTML = `<div class="prom-source-chat-selector-head"><strong>Sources for chat</strong><span>Select a tab</span></div><div class="prom-source-chat-selector-list">${tabs.map((tab) => `<button type="button" data-source-chat="${escapeHtml(tab.sessionId)}"><span>${escapeHtml(tab.title)}</span>${tab.sessionId === currentMainSessionId() ? '<small>Main</small>' : tab.sessionId === state.sideSessionId ? '<small>Side</small>' : ''}</button>`).join('')}</div>`;
  return true;
}

function withTemporaryActiveSession(sessionId, callback) {
  const sid = clean(sessionId);
  const previous = window.activeChatSessionId;
  let assigned = false;
  try {
    window.activeChatSessionId = sid;
    assigned = true;
  } catch {}
  try { return callback?.(); }
  finally {
    if (assigned) {
      try { window.activeChatSessionId = previous; } catch {}
    }
  }
}

function applyNativeSourceContext(sessionId, { openDrawer = false } = {}) {
  const sid = clean(sessionId);
  if (!sid) return;
  state.sourceSessionId = sid;
  globalThis.__PROM_SOURCE_PANEL_SELECTED_SESSION_ID = sid;
  persistState();
  try { window.dispatchEvent(new CustomEvent('prometheus:source-context-select', { detail: { sessionId: sid, source: 'multi-chat-tabs' } })); } catch {}
  withTemporaryActiveSession(sid, () => {
    try { window.ensureSourcePanelContext?.(sid); } catch {}
    try { window.loadSourcePanelGit?.(sid); } catch {}
    try { window.loadChatResources?.({ sessionId: sid, background: true }); } catch {}
    try { window.refreshSourcePanel?.(); } catch {}
    if (openDrawer) {
      if (typeof window.openFullSourcePanel === 'function') window.openFullSourcePanel();
      else if (typeof window.toggleRightPanel === 'function') window.toggleRightPanel();
    }
  });
  renderTabStrip();
}

function sourceTriggerKind(target) {
  const button = target?.closest?.('button, [role="button"]');
  if (!button) return '';
  if (button.closest('#sources-minimized-panel')) return '';
  const onclick = clean(button.getAttribute('onclick'));
  const label = `${button.id || ''} ${button.title || ''} ${button.getAttribute('aria-label') || ''}`.toLowerCase();
  if (/openfullsourcepanel|togglerightpanel/.test(onclick) && /source|right-panel|drawer/.test(label + ' ' + onclick)) return 'drawer';
  if (/togglesources|showsourcesminimizedpanel/.test(onclick) || /source/.test(label) && !/close/.test(label)) return 'sources';
  return '';
}

function handleSourceTriggerCapture(event) {
  if (allSourceTabs().length < 2 || state.sourceSessionId) return;
  const kind = sourceTriggerKind(event.target);
  if (!kind) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  showSourceSelector({ openDrawerAfter: kind === 'drawer' });
}

function handleClick(event) {
  const close = event.target.closest?.('[data-tab-close]');
  if (close) {
    event.preventDefault();
    event.stopPropagation();
    removeTab(close.dataset.tabClose);
    return;
  }
  const open = event.target.closest?.('[data-tab-open]');
  if (open) {
    event.preventDefault();
    activateMain(open.dataset.tabOpen, titleForSession(open.dataset.tabOpen));
    return;
  }
  const source = event.target.closest?.('[data-source-chat]');
  if (source) {
    event.preventDefault();
    const shouldOpen = pendingDrawerOpen;
    pendingDrawerOpen = false;
    applyNativeSourceContext(source.dataset.sourceChat, { openDrawer: shouldOpen });
    const panel = document.getElementById('sources-minimized-panel');
    panel?.classList.remove('prom-source-chat-selector');
    if (shouldOpen) panel?.setAttribute('hidden', '');
    return;
  }
  if (event.target.closest?.('#prom-multi-chat-side-close')) {
    event.preventDefault();
    closeSide();
  }
}

function handleDragStart(event) {
  const tab = event.target.closest?.('.prom-multi-chat-tab');
  const row = event.target.closest?.('.chat-session-item, #sessions-list .job-item');
  const sessionId = tab?.dataset?.sessionId || extractSessionFromRow(row);
  if (!sessionId) return;
  const title = tab?.querySelector?.('.prom-multi-chat-tab-title')?.textContent || titleForSession(sessionId, row?.textContent);
  dragPayload = normalizePayload({ sessionId, title });
  if (!dragPayload) return;
  try {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(dragPayload));
    event.dataTransfer.setData('text/plain', dragPayload.sessionId);
  } catch {}
  document.body.classList.add('prom-multi-chat-dragging');
  ensureDropZones();
}

function handleDragEnd() {
  dragPayload = null;
  document.body.classList.remove('prom-multi-chat-dragging');
  removeDropZones();
}

function ensureDropZones() {
  if (document.getElementById('prom-multi-chat-dropzones')) return;
  const chatView = document.getElementById('chat-view');
  if (!chatView) return;
  const zones = document.createElement('div');
  zones.id = 'prom-multi-chat-dropzones';
  zones.className = 'prom-multi-chat-dropzones';
  zones.innerHTML = '<div class="prom-multi-chat-dropzone" data-chat-drop="main"><strong>Main chat</strong><span>Replace the main pane</span></div><div class="prom-multi-chat-dropzone" data-chat-drop="side"><strong>Side chat</strong><span>Open beside main</span></div>';
  chatView.appendChild(zones);
}

function removeDropZones() {
  document.getElementById('prom-multi-chat-dropzones')?.remove();
}

function handleDragOver(event) {
  const zone = event.target.closest?.('[data-chat-drop]');
  const tab = event.target.closest?.('.prom-multi-chat-tab');
  if (!zone && !tab) return;
  if (!payloadFromEvent(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  zone?.classList.add('is-over');
}

function handleDragLeave(event) {
  event.target.closest?.('[data-chat-drop]')?.classList.remove('is-over');
}

function handleDrop(event) {
  const payload = payloadFromEvent(event);
  if (!payload) return;
  const zone = event.target.closest?.('[data-chat-drop]');
  const tab = event.target.closest?.('.prom-multi-chat-tab');
  if (!zone && !tab) return;
  event.preventDefault();
  event.stopPropagation();
  if (zone?.dataset.chatDrop === 'main') activateMain(payload.sessionId, payload.title);
  else if (zone?.dataset.chatDrop === 'side') openSide(payload.sessionId, payload.title);
  else if (tab) reorderTabs(payload.sessionId, tab.dataset.sessionId);
  handleDragEnd();
}

function render() {
  if (isEmbeddedSidePane()) return;
  renderTabStrip();
  renderSidePane();
}

function syncMainSession() {
  const sid = currentMainSessionId();
  if (!sid || sid === state.mainSessionId) return;
  state.mainSessionId = sid;
  addTab(sid, titleForSession(sid));
  renderTabStrip();
}

function installParentWorkspace() {
  if (installed) return;
  installed = true;
  ensureStylesheet();
  readStoredState();
  document.addEventListener('click', handleSourceTriggerCapture, true);
  document.addEventListener('click', handleClick);
  document.addEventListener('dragstart', handleDragStart, true);
  document.addEventListener('dragend', handleDragEnd, true);
  document.addEventListener('dragover', handleDragOver, true);
  document.addEventListener('dragleave', handleDragLeave, true);
  document.addEventListener('drop', handleDrop, true);
  observer = new MutationObserver(() => {
    syncMainSession();
    if (!document.getElementById('prom-multi-chat-tabs')) render();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  activeSessionPoll = window.setInterval(syncMainSession, 900);
  render();
}

function installEmbeddedSidePane() {
  ensureStylesheet();
  document.body.classList.add('prom-multi-chat-embedded-side');
  const params = new URLSearchParams(location.search);
  const sid = clean(params.get(SESSION_PARAM));
  if (!sid) return;
  const choose = () => {
    if (currentMainSessionId() === sid) return true;
    return callNativeSessionSwitcher(sid);
  };
  choose();
  const timer = window.setInterval(() => {
    if (currentMainSessionId() === sid) {
      window.clearInterval(timer);
      return;
    }
    choose();
  }, 500);
  window.setTimeout(() => window.clearInterval(timer), 15000);
}

export function installMultiChatWorkspace() {
  if (typeof document === 'undefined') return;
  if (isEmbeddedSidePane()) installEmbeddedSidePane();
  else installParentWorkspace();
}

window.__PROM_MULTI_CHAT_WORKSPACE = {
  getState: () => ({ ...state, tabs: state.tabs.map((tab) => ({ ...tab })) }),
  openSide,
  activateMain,
  closeSide,
  closeTab: removeTab,
  showSourceSelector,
  selectSources: (sessionId, options = {}) => applyNativeSourceContext(sessionId, options),
  render,
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMultiChatWorkspace, { once: true });
else installMultiChatWorkspace();
