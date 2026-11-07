// Desktop/web chat integration for protected access cards. Kept out of
// ChatPage.js (size ratchet). Loaded by desktop-entry.js after desktop modules.
// Metadata polling only; secret values stay inside the card's native inputs and
// never touch chat state, composer drafts or the question pipeline. On
// save/cancel/sign-in the originating chat continues with one metadata-only
// line through the existing queued send (window.sendChat).
import { api } from '../../api.js';
import { mountSecureAccessDock, createSecureAccessContinuation } from './secure-access-core.js';
import { installComposerSecretGuard, createAddSecretButton } from './protected-plugin-entry.js';
import { openProtectedPluginCard, protectedRequestFromAction } from './protected-plugin-card.js';

// ChatPage connection cards reach the shared card through this bridge (ChatPage size ratchet).
window.promProtectedPlugin = Object.freeze({
  fromAction: protectedRequestFromAction,
  open: (options = {}) => openProtectedPluginCard((path, opts = {}) => api(path, opts), options),
});

/** Add secret button + accidental-paste guard on the real desktop composer only. */
export function installDesktopProtectedEntry(doc = document) {
  const input = doc.getElementById('chat-input');
  if (!input) return null;
  const fetchJson = (path, opts = {}) => api(path, opts);
  const sendButton = doc.getElementById('send-btn');
  if (sendButton?.parentElement && !doc.querySelector('[data-add-secret]')) sendButton.parentElement.insertBefore(createAddSecretButton(fetchJson, { className: 'sa-add-secret-desktop' }), sendButton);
  return installComposerSecretGuard(input, { fetchJson, sendButton });
}

const activeSessionId = () => String(window.activeChatSessionId || '').trim();

export function installDesktopSecureAccessDock() {
  if (window.__promSecureAccessDock) return window.__promSecureAccessDock;
  const messages = document.getElementById('chat-messages');
  if (!messages?.parentElement) return null;
  const host = document.createElement('div');
  host.id = 'secure-access-dock';
  host.className = 'sa-dock-desktop';
  messages.insertAdjacentElement('afterend', host);
  const continueChat = createSecureAccessContinuation((text, meta) => {
    if (activeSessionId() !== meta.sessionId) return undefined;
    return window.sendChat?.({ message: text });
  });
  window.__promSecureAccessDock = mountSecureAccessDock(host, {
    fetchJson: (path, opts = {}) => api(path, opts),
    sessionId: activeSessionId(),
    getSessionId: activeSessionId,
    onResolved: continueChat,
  });
  try { installDesktopProtectedEntry(); } catch { /* composer not mounted */ }
  return window.__promSecureAccessDock;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installDesktopSecureAccessDock, { once: true });
else installDesktopSecureAccessDock();
