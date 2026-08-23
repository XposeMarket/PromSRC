const SESSION_ROW_SELECTOR = '.chat-session-item, #sessions-list .job-item, #channels-list .chat-session-item';
const STORAGE_KEY = 'prometheus_multi_chat_tabs_v3';
let workspacePromise = null;

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
  if (!event.target?.closest?.(SESSION_ROW_SELECTOR)) return;
  requestMultiChatWorkspace();
}

function requestMultiChatWorkspace() {
  void loadMultiChatWorkspace().catch((error) => {
    console.warn('[multi-chat] workspace failed to load:', error);
  });
}

// Session selection is ordinary chat navigation, not multi-pane intent. Actual
// drag and explicit side/multi-chat actions are the activation signals.
document.addEventListener('dragstart', sessionIntent, true);
window.addEventListener('prometheus:open-multi-chat', requestMultiChatWorkspace);
window.addEventListener('prometheus:side-chat-state', (event) => {
  if (event?.detail?.open === true) requestMultiChatWorkspace();
});
window.ensureMultiChatWorkspace = loadMultiChatWorkspace;

if (hasPersistedWorkspace()) requestMultiChatWorkspace();
