// Desktop chat tabs + side-by-side split.
//
// Browser model: every open chat is a tab. The strip replaces the chat context
// header on desktop. "+" and the regular New chat button both open a fresh
// "New chat" tab; sidebar navigation reuses the current tab unless that tab is
// still working (or is the right-hand pane), in which case it opens beside it.
// Dragging a tab or sidebar row onto the chat opens it on the left or side by
// side. The right pane reuses ChatPage's native split renderer through
// window.sideChatLinks entries flagged `multiChat`, so it survives left-tab
// switches. This module never parses the stored session cache on render; tab
// metadata comes from the in-memory session registry.
const MULTI_CHAT_STORAGE_KEY = 'prometheus_multi_chat_tabs_v3';
const DRAG_MIME = 'application/x-prometheus-chat';
const MAX_TABS = 30;
const NEW_CHAT_TITLE = 'New chat';
const RUNNING_RECHECK_MS = 1500;
const NEW_TAB_INTENT_TTL_MS = 10000;
const SESSION_ROW_SELECTOR = '.chat-session-item, #sessions-list .job-item, #channels-list .chat-session-item';

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
let newTabIntent = null;
let openInNewTabSessionId = '';
let lastPersisted = '';
let lastStripSignature = '';
let runningRecheckTimer = 0;

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
  if (document.querySelector?.('link[data-prom-multi-chat-style="1"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.dataset.promMultiChatStyle = '1';
  link.href = new URL('../../styles/multi-chat-workspace.css', import.meta.url).href;
  document.head?.appendChild(link);
}

function normalizeStoredTab(tab) {
  const sessionId = clean(tab?.sessionId);
  if (!sessionId) return null;
  return { sessionId, title: clean(tab?.title) || NEW_CHAT_TITLE, ...(tab?.draft === true ? { draft: true } : {}) };
}

function readStoredState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MULTI_CHAT_STORAGE_KEY) || '{}');
    const tabs = Array.isArray(parsed?.tabs) ? parsed.tabs : [];
    state.tabs = tabs
      .map(normalizeStoredTab)
      .filter(Boolean)
      .filter((tab, index, all) => all.findIndex((candidate) => candidate.sessionId === tab.sessionId) === index)
      .slice(-MAX_TABS);
    state.mainSessionId = clean(parsed?.mainSessionId);
    state.sideSessionId = clean(parsed?.sideSessionId);
    state.sourceSessionId = clean(parsed?.sourceSessionId);
  } catch {}
}

function serializeState() {
  return JSON.stringify({
    tabs: state.tabs.slice(-MAX_TABS).map((tab) => ({
      sessionId: tab.sessionId,
      title: tab.title,
      ...(tab.draft === true ? { draft: true } : {}),
    })),
    mainSessionId: state.mainSessionId,
    sideSessionId: state.sideSessionId,
    sourceSessionId: state.sourceSessionId,
  });
}

// Renders call this often; only touch localStorage when the layout changed.
function persistState() {
  const serialized = serializeState();
  if (serialized === lastPersisted) return;
  try {
    localStorage.setItem(MULTI_CHAT_STORAGE_KEY, serialized);
    lastPersisted = serialized;
  } catch {}
}

function sessionRecords() {
  const direct = Array.isArray(window.chatSessions) ? window.chatSessions : [];
  const stateRecords = Array.isArray(window.state?.chatSessions) ? window.state.chatSessions : [];
  return stateRecords.length ? [...direct, ...stateRecords] : direct;
}

function recordSessionId(record) {
  return clean(record?.sessionId || record?.id || record?.session_id);
}

function recordTitle(record) {
  return clean(record?.title || record?.name || record?.label || record?.summary);
}

function sessionRecord(sessionId) {
  const sid = clean(sessionId);
  if (!sid) return null;
  return sessionRecords().find((candidate) => recordSessionId(candidate) === sid) || null;
}

function titleOverrideForSession(sessionId) {
  const override = window.__PROM_CHAT_TITLE_OVERRIDE;
  if (!override || clean(override.sessionId) !== clean(sessionId)) return '';
  return clean(override.title);
}

function sessionMeta(sessionId, fallbackTitle = '') {
  const sid = clean(sessionId);
  const record = sessionRecord(sid);
  const title = titleOverrideForSession(sid) || recordTitle(record) || clean(fallbackTitle) || NEW_CHAT_TITLE;
  const projectName = clean(record?.projectName || record?.canvasProjectLabel || '');
  return {
    sessionId: sid,
    title,
    projectName,
    projectId: clean(record?.projectId || ''),
    known: !!record,
    unread: record?.unread === true,
  };
}

function titleForSession(sessionId, fallback = '') {
  return sessionMeta(sessionId, fallback).title;
}

function currentMainSessionId() {
  return clean(window.activeChatSessionId || window.state?.activeChatSessionId || window.agentSessionId);
}

function isSessionRunning(sessionId) {
  const sid = clean(sessionId);
  return !!sid && window._sessionThinking?.[sid] === true;
}

function isEmptyDraft(sessionId) {
  const sid = clean(sessionId);
  if (!sid || isSessionRunning(sid)) return false;
  const record = sessionRecord(sid);
  if (!record) {
    return sid !== currentMainSessionId() || !(Array.isArray(window.chatHistory) && window.chatHistory.length);
  }
  const history = Array.isArray(record.history) ? record.history : [];
  return !history.length && !Number(record.messageCount || 0) && !Number(record.lastMessageAt || 0)
    && (!recordTitle(record) || recordTitle(record) === NEW_CHAT_TITLE);
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
  return Array.from(document.querySelectorAll?.(SESSION_ROW_SELECTOR) || []);
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
  if (state.tabs.length > MAX_TABS) state.tabs.splice(MAX_TABS);
  persistState();
  return true;
}

function closeNativeSideIfOwned(sessionId = state.sideSessionId) {
  const sid = clean(sessionId);
  if (!sid) return;
  if (clean(window.activeSideChatId) !== sid || window.sideChatSplitOpen !== true) return;
  try { window.closeSideChatSplit?.(); } catch {}
}

function nativeSideOpenFor(sessionId) {
  const sid = clean(sessionId);
  return !!sid && window.sideChatSplitOpen === true && clean(window.activeSideChatId) === sid;
}

// Evict the oldest idle background tabs first; never the visible or working ones.
function trimTabs(keepId = '') {
  while (state.tabs.length > MAX_TABS) {
    const victim = state.tabs.findIndex((tab) => tab.sessionId !== keepId
      && tab.sessionId !== state.sideSessionId
      && tab.sessionId !== currentMainSessionId()
      && !isSessionRunning(tab.sessionId));
    if (victim < 0) break;
    state.tabs.splice(victim, 1);
  }
}

function consumeNewTabIntent(sessionId) {
  const sid = clean(sessionId);
  if (openInNewTabSessionId && openInNewTabSessionId === sid) {
    openInNewTabSessionId = '';
    return true;
  }
  if (newTabIntent && newTabIntent.sessionId === sid && Date.now() - newTabIntent.at < NEW_TAB_INTENT_TTL_MS) {
    newTabIntent = null;
    return true;
  }
  return false;
}

function canNavigateTabAway(sessionId) {
  const sid = clean(sessionId);
  return !!sid && sid !== state.sideSessionId && !isSessionRunning(sid);
}

// Enroll the visible main chat. Navigation reuses the previous tab (browser
// link-click semantics) unless the user asked for a new tab or the previous
// tab is still working; an empty "New chat" tab is always reused.
function placeMainTab(sessionId, previousId = '') {
  const sid = clean(sessionId);
  if (!sid || state.tabs.some((tab) => tab.sessionId === sid)) return false;
  const prev = clean(previousId);
  const wantsNewTab = consumeNewTabIntent(sid);
  const prevIndex = prev ? state.tabs.findIndex((tab) => tab.sessionId === prev) : -1;
  const tab = { sessionId: sid, title: titleForSession(sid), ...(sessionRecord(sid) ? {} : { draft: true }) };
  if (prevIndex < 0) {
    state.tabs.push(tab);
  } else {
    const replace = wantsNewTab
      ? (prev !== state.sideSessionId && isEmptyDraft(prev))
      : canNavigateTabAway(prev);
    if (replace) state.tabs[prevIndex] = tab;
    else state.tabs.splice(prevIndex + 1, 0, tab);
  }
  if (tab.draft) {
    // Keep at most one blank "New chat" tab: older unsent drafts are dropped.
    state.tabs = state.tabs.filter((candidate) => candidate.sessionId === sid
      || candidate.sessionId === state.sideSessionId
      || !(candidate.draft && !sessionRecord(candidate.sessionId) && !isSessionRunning(candidate.sessionId)));
  }
  trimTabs(sid);
  return true;
}

function tabNeighborAfterClose(tabs, sessionId) {
  const index = tabs.findIndex((tab) => tab.sessionId === sessionId);
  return index < 0 ? null : (tabs[index + 1] || tabs[index - 1] || null);
}

function clearSourceSelection() {
  const hadSelection = !!state.sourceSessionId || !!clean(globalThis.__PROM_SOURCE_PANEL_SELECTED_SESSION_ID);
  state.sourceSessionId = '';
  if (!hadSelection) return;
  globalThis.__PROM_SOURCE_PANEL_SELECTED_SESSION_ID = '';
  const sid = currentMainSessionId();
  try { window.dispatchEvent(new CustomEvent('prometheus:source-context-select', { detail: { sessionId: sid, source: 'multi-chat-tabs' } })); } catch {}
  try { window.refreshSourcePanel?.(); } catch {}
}

function removeTab(sessionId) {
  const sid = clean(sessionId);
  if (!sid) return;
  const wasSide = state.sideSessionId === sid;
  const wasMain = currentMainSessionId() === sid;
  const promotedSide = wasMain ? clean(state.sideSessionId) : '';
  const neighbor = tabNeighborAfterClose(state.tabs.filter((tab) => tab.sessionId === sid || tab.sessionId !== promotedSide), sid);
  state.tabs = state.tabs.filter((tab) => tab.sessionId !== sid);
  if (wasSide || promotedSide) {
    const closing = state.sideSessionId;
    state.sideSessionId = '';
    pendingSideSessionId = '';
    closeNativeSideIfOwned(closing);
  }
  if (state.sourceSessionId === sid || wasSide || promotedSide) clearSourceSelection();
  if (wasMain) {
    // Closing the left pane lets the right pane's chat take over the view.
    const next = promotedSide || neighbor?.sessionId || '';
    if (next) activateMain(next, titleForSession(next));
    else if (typeof window.newChatSession === 'function') window.newChatSession();
  }
  persistState();
  render();
}

function callNativeSessionSwitcher(sessionId) {
  const sid = clean(sessionId);
  if (!sid) return false;
  const tab = state.tabs.find((candidate) => candidate.sessionId === sid);
  if (tab?.draft && !sessionRecord(sid) && typeof window.reopenDesktopDraftChatSession === 'function') {
    try { window.reopenDesktopDraftChatSession(sid); return true; } catch {}
  }
  // The sidebar row knows the right opener for channel/terminal sessions.
  const row = findSidebarRow(sid);
  if (row) {
    row.click();
    return true;
  }
  for (const name of ['openSession', 'openChatSession', 'selectChatSession', 'switchChatSession', 'loadChatSession']) {
    if (typeof window[name] === 'function') {
      try { window[name](sid); return true; } catch {}
    }
  }
  try {
    window.dispatchEvent(new CustomEvent('prometheus:open-chat-session', { detail: { sessionId: sid, source: 'multi-chat' } }));
    return true;
  } catch { return false; }
}

function ensureNativeSideLink(sessionId = state.sideSessionId, parentId = currentMainSessionId()) {
  const sid = clean(sessionId);
  const parentSessionId = clean(parentId);
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
      multiChat: true,
      __promMultiChatTab: true,
    };
    window.sideChatLinks.push(link);
  } else {
    link.parentSessionId = parentSessionId;
    link.title = titleForSession(sid, link.title);
    link.updatedAt = now;
    link.closed = false;
    // A tab pane is an independent chat that stays beside whatever is on the left.
    link.multiChat = true;
    link.__promMultiChatTab = true;
  }
  window.sideChatLinks = window.sideChatLinks.filter((candidate, index, all) => {
    const candidateId = clean(candidate?.id || candidate?.sessionId);
    return candidateId !== sid || all.findIndex((item) => clean(item?.id || item?.sessionId) === sid) === index;
  });
  return link;
}

function syncSplitBodyClass() {
  const sid = clean(state.sideSessionId);
  document.body?.classList?.toggle('prom-multi-chat-native-split', Boolean(sid && nativeSideOpenFor(sid)));
}

function revealNativeSide(attempt = 0, expectedSessionId = state.sideSessionId) {
  const sid = clean(state.sideSessionId);
  const expectedSid = clean(expectedSessionId);
  if (!sid || !expectedSid || sid !== expectedSid) return false;
  const parentSessionId = currentMainSessionId();
  if (!parentSessionId || sid === parentSessionId) return false;
  ensureNativeSideLink(sid, parentSessionId);
  if (nativeSideOpenFor(sid)) {
    pendingSideSessionId = '';
    syncSplitBodyClass();
    return true;
  }
  if (typeof window.showSideChatSplit === 'function') {
    const opened = window.showSideChatSplit(sid) !== false;
    if (opened) {
      pendingSideSessionId = '';
      syncSplitBodyClass();
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
    // Repaint the open pane once with the hydrated history.
    if (nativeSideOpenFor(sid) && typeof window.showSideChatSplit === 'function') window.showSideChatSplit(sid);
    else revealNativeSide();
    syncSplitBodyClass();
  }
}

function activateMain(sessionId, title = '') {
  const sid = clean(sessionId);
  if (!sid) return;
  addExplicitTab(sid, title);
  if (sid === state.sideSessionId && sid !== currentMainSessionId()) {
    // Already visible on the right: focus it instead of rearranging panes.
    document.getElementById('side-chat-input')?.focus?.();
    renderTabStrip();
    return;
  }
  // The right pane stays put while the left pane switches chats.
  if (state.sideSessionId && state.sideSessionId !== sid) ensureNativeSideLink(state.sideSessionId, sid);
  callNativeSessionSwitcher(sid);
  persistState();
  renderTabStrip();
}

function openSide(sessionId, title = '') {
  const sid = clean(sessionId);
  const mainId = currentMainSessionId();
  if (!sid || !mainId) return;
  if (sid === state.sideSessionId) {
    document.getElementById('side-chat-input')?.focus?.();
    return;
  }
  if (sid === mainId) {
    // Dragging the left chat to the right: swap an existing split, otherwise
    // move it right and bring its neighbouring tab into the left pane.
    if (state.sideSessionId) { swapPanes(); return; }
    const neighbor = tabNeighborAfterClose(state.tabs, sid);
    if (!neighbor) {
      document.getElementById('chat-input')?.focus?.();
      return;
    }
    state.sideSessionId = sid;
    pendingSideSessionId = sid;
    ensureNativeSideLink(sid, neighbor.sessionId);
    persistState();
    callNativeSessionSwitcher(neighbor.sessionId);
    return;
  }
  ensureMainTab(mainId, titleForSession(mainId));
  addExplicitTab(sid, title);
  state.sideSessionId = sid;
  pendingSideSessionId = sid;
  clearSourceSelection();
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
  clearSourceSelection();
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

function moveTabToEnd(sessionId) {
  const from = state.tabs.findIndex((tab) => tab.sessionId === clean(sessionId));
  if (from < 0 || from === state.tabs.length - 1) return;
  const [tab] = state.tabs.splice(from, 1);
  state.tabs.push(tab);
  persistState();
  renderTabStrip();
}

// Left and right chats trade places; both tabs stay where they are.
function swapPanes() {
  const mainId = currentMainSessionId();
  const sideId = clean(state.sideSessionId);
  if (!mainId || !sideId || mainId === sideId) return false;
  state.sideSessionId = mainId;
  pendingSideSessionId = mainId;
  ensureNativeSideLink(mainId, sideId);
  persistState();
  callNativeSessionSwitcher(sideId);
  return true;
}

function openInNewTab(sessionId, title = '', beforeId = '') {
  const sid = clean(sessionId);
  if (!sid) return;
  if (!state.tabs.some((tab) => tab.sessionId === sid)) {
    const tab = { sessionId: sid, title: clean(title) || titleForSession(sid) };
    const index = beforeId ? state.tabs.findIndex((candidate) => candidate.sessionId === clean(beforeId)) : -1;
    if (index < 0) state.tabs.push(tab);
    else state.tabs.splice(index, 0, tab);
    trimTabs(sid);
  }
  activateMain(sid, title);
}

function cycleTabs(direction = 1) {
  const candidates = state.tabs.filter((tab) => tab.sessionId !== state.sideSessionId);
  if (candidates.length < 2) return;
  const index = candidates.findIndex((tab) => tab.sessionId === currentMainSessionId());
  const next = candidates[(index + direction + candidates.length) % candidates.length];
  if (next) activateMain(next.sessionId, next.title);
}

const SPLIT_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 2.75v10.5" stroke="currentColor" stroke-width="1.3"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.25v9.5M3.25 8h9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const FOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l1.7 2h7.3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>';

function ensureTabStrip() {
  let strip = document.getElementById('prom-multi-chat-tabs');
  const mainShell = document.querySelector?.('.main-shell');
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
  // Mouse wheels only emit deltaY; scroll the tab rail sideways instead.
  strip.addEventListener?.('wheel', (event) => {
    if (event.ctrlKey || strip.scrollWidth <= strip.clientWidth + 1) return;
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    strip.scrollLeft += event.deltaY;
    event.preventDefault();
  }, { passive: false });
  mainShell.insertBefore(strip, mainShell.firstElementChild);
  return strip;
}

function tabViewModel() {
  const mainId = currentMainSessionId();
  return state.tabs.map((tab) => {
    const meta = sessionMeta(tab.sessionId, tab.title);
    if (meta.known && tab.draft) delete tab.draft;
    tab.title = meta.title;
    const isMain = tab.sessionId === mainId;
    const isSide = !isMain && tab.sessionId === state.sideSessionId;
    return {
      id: tab.sessionId,
      title: meta.title,
      project: meta.projectName,
      isMain,
      isSide,
      running: isSessionRunning(tab.sessionId),
      unread: !isMain && !isSide && meta.unread,
    };
  });
}

function renderTabHtml(tab) {
  const classes = ['prom-multi-chat-tab', tab.isMain && 'is-main', tab.isSide && 'is-side', tab.running && 'is-running', tab.unread && 'is-unread']
    .filter(Boolean).join(' ');
  const tooltip = [tab.title, tab.project, tab.running ? 'Working…' : '', tab.isSide ? 'Open on the right' : ''].filter(Boolean).join(' · ');
  const id = escapeHtml(tab.id);
  const title = escapeHtml(tab.title);
  return `<div class="${classes}" draggable="true" role="tab" aria-selected="${tab.isMain ? 'true' : 'false'}" data-session-id="${id}" title="${escapeHtml(tooltip)}">
      <button type="button" class="prom-multi-chat-tab-open" data-tab-open="${id}"><span class="prom-multi-chat-tab-status" aria-hidden="true"></span>${tab.isSide ? `<span class="prom-multi-chat-tab-pane" aria-hidden="true">${SPLIT_ICON}</span>` : ''}<span class="prom-multi-chat-tab-title">${title}</span></button>
      <button type="button" class="prom-multi-chat-tab-close" data-tab-close="${id}" aria-label="Close ${title} tab" title="Close tab">×</button>
    </div>`;
}

function revealActiveTab(strip) {
  const active = strip.querySelector?.('.prom-multi-chat-tab.is-main');
  if (!active) return;
  const left = active.offsetLeft;
  const right = left + active.offsetWidth;
  if (left < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - 8);
  else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth + 48;
}

// Background tabs have no render event when their run ends; re-check only
// while something is actually working, never as a standing poll.
function scheduleRunningRecheck(model) {
  if (runningRecheckTimer || !model.some((tab) => tab.running)) return;
  runningRecheckTimer = window.setTimeout(() => {
    runningRecheckTimer = 0;
    if (!document.hidden) renderTabStrip();
  }, RUNNING_RECHECK_MS);
}

function renderTabStrip() {
  const strip = ensureTabStrip();
  if (!strip) return;
  const model = tabViewModel();
  const project = model.find((tab) => tab.isMain)?.project || '';
  const signature = JSON.stringify([model, project]);
  if (signature !== lastStripSignature || !strip.firstElementChild) {
    lastStripSignature = signature;
    strip.innerHTML = `${model.map(renderTabHtml).join('')}<button type="button" class="prom-multi-chat-new" data-tab-new aria-label="New chat tab" title="New chat">${PLUS_ICON}</button>${project ? `<span class="prom-multi-chat-project" title="Project: ${escapeHtml(project)}">${FOLDER_ICON}<span>${escapeHtml(project)}</span></span>` : ''}`;
    revealActiveTab(strip);
  }
  strip.hidden = state.tabs.length === 0;
  document.body?.classList?.toggle('prom-multi-chat-tabs-active', !strip.hidden);
  persistState();
  scheduleRunningRecheck(model);
}

// Sources follow the visible main chat; only a two-pane split needs a choice.
function allSourceTabs() {
  const visible = new Set([currentMainSessionId(), nativeSideOpenFor(state.sideSessionId) ? state.sideSessionId : '']
    .map(clean).filter(Boolean));
  return state.tabs.filter((tab) => visible.has(tab.sessionId));
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
  panel.innerHTML = `<div class="prom-source-chat-selector-head"><strong>Sources for chat</strong><span>Pick a pane</span></div><div class="prom-source-chat-selector-list">${tabs.map((tab) => {
    const meta = sessionMeta(tab.sessionId, tab.title);
    const side = tab.sessionId === state.sideSessionId ? 'Right' : 'Left';
    return `<button type="button" data-source-chat="${escapeHtml(tab.sessionId)}"><span>${escapeHtml(meta.title)}</span><small>${escapeHtml(meta.projectName ? `${side} · ${meta.projectName}` : side)}</small></button>`;
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
  if (event.target.closest?.('[data-tab-new]')) {
    event.preventDefault();
    window.newChatSession?.();
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

function sessionRowFromEvent(event) {
  const row = event.target?.closest?.(SESSION_ROW_SELECTOR);
  if (!row || window.sessionsEditMode) return null;
  // Option menus, pins and inline buttons inside a row keep their own behaviour.
  const control = event.target.closest?.('button, a, input, select, [role="menu"], [role="menuitem"]');
  return control && control !== row && row.contains(control) ? null : row;
}

// Ctrl/Cmd-click on a sidebar chat opens it in a new tab; the native click still opens it.
function handleSessionRowModifierClick(event) {
  if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return;
  const row = sessionRowFromEvent(event);
  const sid = extractSessionFromRow(row);
  if (sid && sid !== currentMainSessionId()) openInNewTabSessionId = sid;
}

function handleMiddleMouseDown(event) {
  if (event.button !== 1) return;
  if (event.target.closest?.('.prom-multi-chat-tab') || sessionRowFromEvent(event)) event.preventDefault();
}

function handleAuxClick(event) {
  if (event.button !== 1) return;
  const tab = event.target.closest?.('.prom-multi-chat-tab');
  if (tab) {
    event.preventDefault();
    removeTab(tab.dataset.sessionId);
    return;
  }
  const sid = extractSessionFromRow(sessionRowFromEvent(event));
  if (!sid) return;
  event.preventDefault();
  if (state.tabs.some((candidate) => candidate.sessionId === sid)) { activateMain(sid); return; }
  openInNewTabSessionId = sid;
  callNativeSessionSwitcher(sid);
}

function handleKeydown(event) {
  if (!event.ctrlKey || event.altKey || event.metaKey || event.key !== 'Tab') return;
  if (String(window.currentMode || 'chat') !== 'chat' || document.body?.classList?.contains('pm-mobile-active')) return;
  if (state.tabs.length < 2) return;
  event.preventDefault();
  cycleTabs(event.shiftKey ? -1 : 1);
}

function handleDragStart(event) {
  const tab = event.target.closest?.('.prom-multi-chat-tab');
  const row = event.target.closest?.(SESSION_ROW_SELECTOR);
  const sessionId = tab?.dataset?.sessionId || extractSessionFromRow(row);
  if (!sessionId) return;
  const title = tab?.querySelector?.('.prom-multi-chat-tab-title')?.textContent || titleForSession(sessionId, row?.dataset?.sessionTitle);
  dragPayload = normalizePayload({ sessionId, title });
  if (!dragPayload) return;
  try {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(dragPayload));
    event.dataTransfer.setData('text/plain', dragPayload.sessionId);
  } catch {}
  beginSessionDrag(dragPayload);
}

export function beginSessionDrag(payload) {
  dragPayload = normalizePayload(payload);
  if (!dragPayload) return;
  document.body.classList.add('prom-multi-chat-dragging');
  ensureDropZones();
}

function clearDropTargets() {
  document.querySelectorAll?.('.prom-multi-chat-tab.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
}

function handleDragEnd() {
  dragPayload = null;
  document.body.classList.remove('prom-multi-chat-dragging');
  removeDropZones();
  clearDropTargets();
}

function ensureDropZones() {
  if (document.getElementById('prom-multi-chat-dropzones')) return;
  const chatView = document.getElementById('chat-view');
  if (!chatView) return;
  const split = Boolean(state.sideSessionId && nativeSideOpenFor(state.sideSessionId));
  const zones = document.createElement('div');
  zones.id = 'prom-multi-chat-dropzones';
  zones.className = `prom-multi-chat-dropzones${split ? ' is-split' : ''}`;
  const label = (title, hint) => `<div class="prom-multi-chat-dropzone-label"><strong>${title}</strong><span>${hint}</span></div>`;
  zones.innerHTML = `<div class="prom-multi-chat-dropzone" data-chat-drop="main">${label(split ? 'Open on the left' : 'Open here', split ? 'Replaces the left pane' : 'Switches this view')}</div>`
    + `<div class="prom-multi-chat-dropzone" data-chat-drop="side">${label(split ? 'Open on the right' : 'Split view', split ? 'Replaces the right pane' : 'Opens side by side')}</div>`;
  chatView.appendChild(zones);
}

function removeDropZones() {
  document.getElementById('prom-multi-chat-dropzones')?.remove();
}

function handleDragOver(event) {
  const zone = event.target.closest?.('[data-chat-drop]');
  const tab = event.target.closest?.('.prom-multi-chat-tab');
  const strip = event.target.closest?.('#prom-multi-chat-tabs');
  if (!zone && !tab && !strip) return;
  if (!payloadFromEvent(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  zone?.classList.add('is-over');
  if (tab && !tab.classList.contains('is-drop-target')) {
    clearDropTargets();
    tab.classList.add('is-drop-target');
  }
}

function handleDragLeave(event) {
  event.target.closest?.('[data-chat-drop]')?.classList.remove('is-over');
  const tab = event.target.closest?.('.prom-multi-chat-tab');
  if (tab && !tab.contains(event.relatedTarget)) tab.classList.remove('is-drop-target');
}

function handleDrop(event) {
  const payload = payloadFromEvent(event);
  if (!payload) return;
  const zone = event.target.closest?.('[data-chat-drop]');
  const tab = event.target.closest?.('.prom-multi-chat-tab');
  const strip = event.target.closest?.('#prom-multi-chat-tabs');
  if (!zone && !tab && !strip) return;
  event.preventDefault();
  event.stopPropagation();
  const known = state.tabs.some((candidate) => candidate.sessionId === payload.sessionId);
  if (zone?.dataset.chatDrop === 'main' && payload.sessionId === state.sideSessionId) swapPanes();
  else if (zone?.dataset.chatDrop === 'main') activateMain(payload.sessionId, payload.title);
  else if (zone?.dataset.chatDrop === 'side') openSide(payload.sessionId, payload.title);
  else if (tab && known) reorderTabs(payload.sessionId, tab.dataset.sessionId);
  else if (known) moveTabToEnd(payload.sessionId);
  else openInNewTab(payload.sessionId, payload.title, tab?.dataset?.sessionId || '');
  handleDragEnd();
}

function syncNativeSideState() {
  const sid = clean(state.sideSessionId);
  if (!sid) {
    document.body?.classList?.remove('prom-multi-chat-native-split');
    return;
  }
  if (pendingSideSessionId === sid) return;
  if (!nativeSideOpenFor(sid)) {
    state.sideSessionId = '';
    clearSourceSelection();
    persistState();
    document.body?.classList?.remove('prom-multi-chat-native-split');
    return;
  }
  syncSplitBodyClass();
}

function syncMainSession() {
  const sid = currentMainSessionId();
  if (!sid) return;
  const previous = state.mainSessionId;
  if (sid !== previous) {
    state.mainSessionId = sid;
    if (state.sideSessionId === sid) {
      // The right pane's chat was opened on the left: collapse the split.
      const oldSide = state.sideSessionId;
      state.sideSessionId = '';
      pendingSideSessionId = '';
      closeNativeSideIfOwned(oldSide);
      clearSourceSelection();
    } else if (state.sideSessionId) {
      revealNativeSide();
    } else {
      clearSourceSelection();
    }
  }
  placeMainTab(sid, previous);
  syncNativeSideState();
  renderTabStrip();
}

function render() {
  renderTabStrip();
  const sid = clean(state.sideSessionId);
  if (sid && !nativeSideOpenFor(sid) && pendingSideSessionId !== sid) revealNativeSide();
  syncSplitBodyClass();
}

function pruneStaleDraftTabs() {
  const mainId = currentMainSessionId();
  state.tabs = state.tabs.filter((tab) => !tab.draft || tab.sessionId === mainId || sessionRecord(tab.sessionId));
}

function installWorkspace() {
  if (installed) return;
  installed = true;
  ensureStylesheet();
  readStoredState();
  pruneStaleDraftTabs();
  // ChatPage already restored the remembered chat; enroll it without replacing tabs.
  state.mainSessionId = '';
  const restoredSide = clean(state.sideSessionId);
  const sideRestorable = restoredSide && restoredSide !== currentMainSessionId()
    && state.tabs.some((tab) => tab.sessionId === restoredSide);
  if (sideRestorable) pendingSideSessionId = restoredSide;
  else state.sideSessionId = '';
  window.addEventListener('prometheus:chat-session-deleted', (event) => {
    removeTab(event.detail?.sessionId);
  });
  window.addEventListener('prometheus:chat-new-tab-intent', (event) => {
    const sessionId = clean(event?.detail?.sessionId);
    if (sessionId) newTabIntent = { sessionId, previousSessionId: clean(event.detail?.previousSessionId), at: Date.now() };
  });
  document.addEventListener('click', handleSessionRowModifierClick, true);
  document.addEventListener('click', handleSourceTriggerCapture, true);
  document.addEventListener('click', handleClick);
  document.addEventListener('mousedown', handleMiddleMouseDown, true);
  document.addEventListener('auxclick', handleAuxClick, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('dragstart', handleDragStart, true);
  document.addEventListener('dragend', handleDragEnd, true);
  document.addEventListener('dragover', handleDragOver, true);
  document.addEventListener('dragleave', handleDragLeave, true);
  document.addEventListener('drop', handleDrop, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderTabStrip(); });
  window.addEventListener('prometheus:chat-session-activated', syncMainSession);
  window.addEventListener('prometheus:side-chat-state', () => {
    syncNativeSideState();
    syncMainSession();
  });
  window.addEventListener('prometheus:chat-rendered', syncMainSession);
  window.addEventListener('prometheus:chat-title-override-changed', renderTabStrip);
  syncMainSession();
  if (sideRestorable) void refreshNativeSideSession(restoredSide);
  persistState();
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
  swapPanes,
  closeTab: removeTab,
  openInNewTab,
  cycleTabs,
  showSourceSelector,
  selectSources: (sessionId, options = {}) => applyNativeSourceContext(sessionId, options),
  render,
};
window.refreshPromMultiChatTabs = renderTabStrip;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMultiChatWorkspace, { once: true });
else installMultiChatWorkspace();
