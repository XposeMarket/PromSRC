const MULTI_CHAT_STORAGE_KEY = 'prometheus_multi_chat_tabs_v3';
const DRAG_MIME = 'application/x-prometheus-chat';
const MAX_TABS = 30;

let state = {
  tabs: [],
  mainSessionId: '',
  sideSessionId: '',
  sourceSessionId: '',
};
let installed = false;
let dragPayload = null;
let pendingDrawerOpen = false;
let pendingSideSessionId = '';
let nativeSideRetryTimer = 0;

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

function sessionRecord(sessionId) {
  const sid = clean(sessionId);
  return sessionRecords().find((candidate) => recordSessionId(candidate) === sid) || null;
}

function sessionMeta(sessionId, fallbackTitle = '') {
  const sid = clean(sessionId);
  const record = sessionRecord(sid);
  const row = findSidebarRow(sid);
  const rowTitle = clean(row?.querySelector?.('.job-item-title, .chat-session-title, [data-session-title]')?.textContent || row?.textContent);
  const title = record ? recordTitle(record) : (rowTitle || clean(fallbackTitle) || 'Chat');
  const projectName = clean(record?.projectName || record?.canvasProjectLabel || '');
  return {
    sessionId: sid,
    title,
    projectName,
    projectId: clean(record?.projectId || ''),
  };
}

function titleForSession(sessionId, fallback = '') {
  return sessionMeta(sessionId, fallback).title;
}

function currentMainSessionId() {
  return clean(window.activeChatSessionId || window.state?.activeChatSessionId || window.agentSessionId);
}

function extractSessionFromRow(row) {
  if (!row) return '';
  for (const value of [row.dataset?.sessionId, row.dataset?.chatSessionId, row.dataset?.session, row.dataset?.id]) {
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

function addExplicitTab(sessionId, title = '') {
  const sid = clean(sessionId);
  if (!sid) return false;
  const existing = state.tabs.find((tab) => tab.sessionId === sid);
  if (existing) {
    existing.title = clean(title) || existing.title || titleForSession(sid);
    persistState();
    return false;
  }
  state.tabs.push({ sessionId: sid, title: clean(title) || titleForSession(sid) });
  if (state.tabs.length > MAX_TABS) state.tabs.splice(0, state.tabs.length - MAX_TABS);
  persistState();
  return true;
}

function ensureMainTab(sessionId, title = '') {
  const sid = clean(sessionId);
  if (!sid) return false;
  const existing = state.tabs.find((tab) => tab.sessionId === sid);
  if (existing) {
    existing.title = clean(title) || existing.title || titleForSession(sid);
    return false;
  }
  state.tabs.unshift({ sessionId: sid, title: clean(title) || titleForSession(sid) });
  if (state.tabs.length > MAX_TABS) state.tabs.splice(0, state.tabs.length - MAX_TABS);
  persistState();
  return true;
}

function closeNativeSideIfOwned(sessionId = state.sideSessionId) {
  const sid = clean(sessionId);
  if (!sid) return;
  if (clean(window.activeSideChatId) !== sid || window.sideChatSplitOpen !== true) return;
  try { window.closeSideChatSplit?.(); } catch {}
}

function removeTab(sessionId) {
  const sid = clean(sessionId);
  if (!sid) return;
  const wasSide = state.sideSessionId === sid;
  state.tabs = state.tabs.filter((tab) => tab.sessionId !== sid);
  if (wasSide) {
    state.sideSessionId = '';
    pendingSideSessionId = '';
    closeNativeSideIfOwned(sid);
  }
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

function ensureNativeSideLink(sessionId = state.sideSessionId) {
  const sid = clean(sessionId);
  const parentSessionId = currentMainSessionId();
  if (!sid || !parentSessionId || sid === parentSessionId) return null;
  if (!Array.isArray(window.sideChatLinks)) window.sideChatLinks = [];
  const now = Date.now();
  let link = window.sideChatLinks.find((candidate) => clean(candidate?.id || candidate?.sessionId) === sid) || null;
  if (!link) {
    link = {
      id: sid,
      parentSessionId,
      title: titleForSession(sid),
      anchorIndex: null,
      anchorPreview: '',
      createdAt: now,
      updatedAt: now,
      closed: false,
      __promMultiChatTab: true,
    };
    window.sideChatLinks.push(link);
  } else {
    link.parentSessionId = parentSessionId;
    link.title = titleForSession(sid, link.title);
    link.updatedAt = now;
    link.closed = false;
    link.__promMultiChatTab = true;
  }
  window.sideChatLinks = window.sideChatLinks.filter((candidate, index, all) => {
    const candidateId = clean(candidate?.id || candidate?.sessionId);
    return candidateId !== sid || all.findIndex((item) => clean(item?.id || item?.sessionId) === sid) === index;
  });
  return link;
}

function patchPaneHeader(header, sessionId) {
  if (!header) return;
  const meta = sessionMeta(sessionId);
  const title = header.querySelector('.side-chat-title');
  header.classList.add('prom-multi-chat-session-header');
  header.dataset.multiChatSessionId = meta.sessionId;
  if (title) title.textContent = meta.title;
}

function patchNativeSplitHeaders() {
  const sid = clean(state.sideSessionId);
  const nativeActive = Boolean(sid && window.sideChatSplitOpen === true && clean(window.activeSideChatId) === sid);
  document.body?.classList?.toggle('prom-multi-chat-native-split', nativeActive);
  if (!nativeActive) return;
  const root = document.getElementById('chat-messages');
  patchPaneHeader(root?.querySelector('.side-chat-main-pane .side-chat-pane-header'), currentMainSessionId());
  patchPaneHeader(root?.querySelector('.side-chat-pane .side-chat-header'), sid);
}

function revealNativeSide(attempt = 0, expectedSessionId = state.sideSessionId) {
  const sid = clean(state.sideSessionId);
  const expectedSid = clean(expectedSessionId);
  if (!sid || !expectedSid || sid !== expectedSid) return false;
  const parentSessionId = currentMainSessionId();
  if (!parentSessionId || sid === parentSessionId) return false;
  ensureNativeSideLink(sid);
  if (typeof window.showSideChatSplit === 'function') {
    const opened = window.showSideChatSplit(sid) !== false;
    if (opened) {
      pendingSideSessionId = '';
      window.setTimeout(patchNativeSplitHeaders, 0);
      return true;
    }
  }
  if (attempt < 30) {
    window.clearTimeout(nativeSideRetryTimer);
    nativeSideRetryTimer = window.setTimeout(() => revealNativeSide(attempt + 1, expectedSid), 100);
    return false;
  }
  if (pendingSideSessionId === expectedSid && state.sideSessionId === expectedSid) {
    pendingSideSessionId = '';
    state.sideSessionId = '';
    persistState();
    renderTabStrip();
    document.body?.classList?.remove('prom-multi-chat-native-split');
  }
  return false;
}

async function refreshNativeSideSession(sessionId) {
  const sid = clean(sessionId);
  if (!sid || typeof window._loadSessionFromServer !== 'function') return;
  try {
    // The shared runtime owns the bounded initial suffix and cursor paging.
    // Opening a second pane must not revive the old 300-message suffix fetch.
    await window._loadSessionFromServer(sid, { force: true, historyLimit: 80, processLimit: 240 });
  } catch {}
  if (state.sideSessionId === sid) {
    ensureNativeSideLink(sid);
    revealNativeSide();
    patchNativeSplitHeaders();
  }
}

function activateMain(sessionId, title = '') {
  const sid = clean(sessionId);
  if (!sid) return;
  addExplicitTab(sid, title);
  if (state.sideSessionId === sid) {
    const oldSide = state.sideSessionId;
    state.sideSessionId = '';
    pendingSideSessionId = '';
    closeNativeSideIfOwned(oldSide);
  }
  state.mainSessionId = sid;
  callNativeSessionSwitcher(sid);
  persistState();
  renderTabStrip();
  window.setTimeout(() => {
    state.mainSessionId = currentMainSessionId();
    if (state.sideSessionId && state.sideSessionId !== state.mainSessionId) revealNativeSide();
    patchNativeSplitHeaders();
    renderTabStrip();
  }, 120);
}

function openSide(sessionId, title = '') {
  const sid = clean(sessionId);
  const mainId = currentMainSessionId();
  if (!sid || !mainId || sid === mainId) return;
  ensureMainTab(mainId, titleForSession(mainId));
  addExplicitTab(sid, title);
  state.sideSessionId = sid;
  pendingSideSessionId = sid;
  persistState();
  renderTabStrip();
  revealNativeSide();
  void refreshNativeSideSession(sid);
}

function closeSide() {
  const sid = clean(state.sideSessionId);
  if (!sid) return;
  state.sideSessionId = '';
  pendingSideSessionId = '';
  closeNativeSideIfOwned(sid);
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
  const mainShell = document.querySelector('.main-shell');
  if (!mainShell) return null;
  if (strip) {
    if (strip.parentElement !== mainShell) mainShell.insertBefore(strip, mainShell.firstElementChild);
    return strip;
  }
  strip = document.createElement('div');
  strip.id = 'prom-multi-chat-tabs';
  strip.className = 'prom-multi-chat-tabs';
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', 'Open chats');
  mainShell.insertBefore(strip, mainShell.firstElementChild);
  return strip;
}

function renderTabStrip() {
  const strip = ensureTabStrip();
  if (!strip) return;
  const mainId = currentMainSessionId();
  state.mainSessionId = mainId;
  if (state.sideSessionId && state.sideSessionId !== mainId) {
    ensureMainTab(mainId, titleForSession(mainId));
  }
  strip.innerHTML = state.tabs.map((tab) => {
    const meta = sessionMeta(tab.sessionId, tab.title);
    tab.title = meta.title;
    const isMain = tab.sessionId === mainId;
    const isSide = tab.sessionId === state.sideSessionId;
    const tooltip = meta.projectName ? `${meta.title} · ${meta.projectName}` : meta.title;
    return `<div class="prom-multi-chat-tab${isMain ? ' is-main' : ''}${isSide ? ' is-side' : ''}" draggable="true" role="tab" aria-selected="${isMain ? 'true' : 'false'}" data-session-id="${escapeHtml(tab.sessionId)}" title="${escapeHtml(tooltip)}">
      <button type="button" class="prom-multi-chat-tab-open" data-tab-open="${escapeHtml(tab.sessionId)}"><span class="prom-multi-chat-tab-title">${escapeHtml(meta.title)}</span></button>
      <button type="button" class="prom-multi-chat-tab-close" data-tab-close="${escapeHtml(tab.sessionId)}" aria-label="Close ${escapeHtml(meta.title)} tab" title="Close tab">×</button>
    </div>`;
  }).join('');
  strip.hidden = state.tabs.length === 0;
  persistState();
}

function allSourceTabs() {
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
  panel.innerHTML = `<div class="prom-source-chat-selector-head"><strong>Sources for chat</strong><span>Select a tab</span></div><div class="prom-source-chat-selector-list">${tabs.map((tab) => {
    const meta = sessionMeta(tab.sessionId, tab.title);
    return `<button type="button" data-source-chat="${escapeHtml(tab.sessionId)}"><span>${escapeHtml(meta.title)}</span>${meta.projectName ? `<small>${escapeHtml(meta.projectName)}</small>` : ''}</button>`;
  }).join('')}</div>`;
  return true;
}

function withTemporaryActiveSession(sessionId, callback) {
  const sid = clean(sessionId);
  const previous = window.activeChatSessionId;
  let assigned = false;
  try { window.activeChatSessionId = sid; assigned = true; } catch {}
  try { return callback?.(); }
  finally {
    if (assigned) {
      try { window.activeChatSessionId = previous; } catch {}
    }
  }
}

function applyNativeSourceContext(sessionId, { openDrawer = false } = {}) {
  const sid = clean(sessionId);
  if (!sid || !state.tabs.some((tab) => tab.sessionId === sid)) return;
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
  if (!button || button.closest('#sources-minimized-panel')) return '';
  const onclick = clean(button.getAttribute('onclick'));
  const label = `${button.id || ''} ${button.title || ''} ${button.getAttribute('aria-label') || ''}`.toLowerCase();
  if (/openfullsourcepanel|togglerightpanel/.test(onclick) && /source|right-panel|drawer/.test(`${label} ${onclick}`)) return 'drawer';
  if (/togglesources|showsourcesminimizedpanel/.test(onclick) || (/source/.test(label) && !/close/.test(label))) return 'sources';
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
  zones.innerHTML = '<div class="prom-multi-chat-dropzone" data-chat-drop="main"><strong>Main chat</strong><span>Replace the left pane</span></div><div class="prom-multi-chat-dropzone" data-chat-drop="side"><strong>Side chat</strong><span>Open beside it</span></div>';
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

function syncNativeSideState() {
  const sid = clean(state.sideSessionId);
  if (!sid) {
    document.body?.classList?.remove('prom-multi-chat-native-split');
    return;
  }
  if (pendingSideSessionId === sid) return;
  const nativeOpen = window.sideChatSplitOpen === true && clean(window.activeSideChatId) === sid;
  if (!nativeOpen) {
    state.sideSessionId = '';
    persistState();
    renderTabStrip();
    document.body?.classList?.remove('prom-multi-chat-native-split');
  }
}

function syncMainSession() {
  const sid = currentMainSessionId();
  if (!sid) return;
  if (sid !== state.mainSessionId) {
    state.mainSessionId = sid;
    if (state.sideSessionId === sid) {
      const oldSide = state.sideSessionId;
      state.sideSessionId = '';
      pendingSideSessionId = '';
      closeNativeSideIfOwned(oldSide);
    } else if (state.sideSessionId) {
      revealNativeSide();
    }
    renderTabStrip();
  }
  syncNativeSideState();
  patchNativeSplitHeaders();
}

function render() {
  renderTabStrip();
  if (state.sideSessionId) revealNativeSide();
  patchNativeSplitHeaders();
}

function installWorkspace() {
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
  window.addEventListener('prometheus:chat-session-activated', syncMainSession);
  window.addEventListener('prometheus:side-chat-state', () => {
    syncNativeSideState();
    patchNativeSplitHeaders();
    renderTabStrip();
  });
  window.addEventListener('prometheus:chat-rendered', () => {
    syncMainSession();
    patchNativeSplitHeaders();
    if (!document.getElementById('prom-multi-chat-tabs')) renderTabStrip();
  });
  render();
}

export function installMultiChatWorkspace() {
  if (typeof document === 'undefined') return;
  installWorkspace();
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
