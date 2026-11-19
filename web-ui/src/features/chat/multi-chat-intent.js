const SESSION_ROW_SELECTOR = '.chat-session-item, #sessions-list .job-item, #channels-list .chat-session-item';
const STORAGE_KEY = 'prometheus_multi_chat_tabs_v3';
let workspacePromise = null;
let pendingDrag = null;
document.addEventListener('dragend', () => { pendingDrag = null; }, true);
document.addEventListener('drop', () => { pendingDrag = null; }, true);

function hasPersistedWorkspace() {
  try {
    const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return (Array.isArray(state?.tabs) && state.tabs.length > 0) || !!String(state?.sideSessionId || '').trim();
  } catch {
    return false;
  }
}

export function loadMultiChatWorkspace() {
  if (!workspacePromise) {
    workspacePromise = Promise.resolve().then(() => {
      const testImporter = globalThis.__PROM_MULTI_CHAT_IMPORT_FOR_TESTS;
      if (typeof testImporter === 'function') return testImporter();
      return Promise.all([
        import('./multi-chat-workspace-v2.js'),
        import('./canonical-desktop-composer.js'),
      ]);
    }).then(([workspace]) => {
      workspace.installMultiChatWorkspace?.();
      return workspace;
    }).catch((error) => {
      workspacePromise = null;
      throw error;
    });
  }
  return workspacePromise;
}

function sessionIntent(event) {
  const row = event.target?.closest?.(SESSION_ROW_SELECTOR);
  if (!row) return;
  const sessionId = String(row.dataset?.sessionId || row.dataset?.chatSessionId || row.dataset?.session || row.dataset?.id || '').trim();
  if (!sessionId) return;
  const payload = { sessionId, title: row.querySelector?.('.job-item-title, .chat-session-title, [data-session-title]')?.textContent || '' };
  pendingDrag = payload;
  // DataTransfer is writable only during dragstart, before the lazy import resolves.
  try {
    event.dataTransfer?.setData('application/x-prometheus-chat', JSON.stringify(payload));
    event.dataTransfer?.setData('text/plain', sessionId);
  } catch {}
  void loadMultiChatWorkspace().then((workspace) => {
    if (pendingDrag === payload) workspace.beginSessionDrag?.(payload);
  }).catch((error) => console.warn('[multi-chat] workspace failed to load:', error));
}

function requestMultiChatWorkspace() {
  void loadMultiChatWorkspace().catch((error) => {
    console.warn('[multi-chat] workspace failed to load:', error);
  });
}

// Desktop chat tabs are always visible, but the workspace stays off the boot
// critical path: it loads when the browser is idle after the first chat paint
// (or immediately on drag / side-chat / persisted-tab intent).
let idleLoadScheduled = false;
function scheduleIdleWorkspaceLoad() {
  if (idleLoadScheduled || workspacePromise) return;
  if (window.__PROM_SHOULD_BOOT_MOBILE?.() || document.body?.classList?.contains('pm-mobile-active')) return;
  idleLoadScheduled = true;
  if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(requestMultiChatWorkspace, { timeout: 2000 });
  else setTimeout(requestMultiChatWorkspace, 400);
}

document.addEventListener('dragstart', sessionIntent, true);
window.addEventListener('prometheus:chat-rendered', scheduleIdleWorkspaceLoad, { once: true });
window.addEventListener('prometheus:open-multi-chat', requestMultiChatWorkspace);
window.addEventListener('prometheus:side-chat-state', (event) => {
  if (event?.detail?.open === true) requestMultiChatWorkspace();
});
window.ensureMultiChatWorkspace = loadMultiChatWorkspace;

if (hasPersistedWorkspace()) requestMultiChatWorkspace();
// This module can arrive after the first chat paint already happened.
else if (document.querySelector?.('#chat-messages > *')) scheduleIdleWorkspaceLoad();
