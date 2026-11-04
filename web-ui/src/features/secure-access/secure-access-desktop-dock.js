// Desktop/web chat integration for protected access cards. Kept out of
// ChatPage.js (size ratchet). Loaded by desktop-entry.js after desktop modules.
// Metadata polling only; secret values stay inside the card's native inputs and
// never touch chat state, composer drafts or the question pipeline. On
// save/cancel/sign-in the originating chat continues with one metadata-only
// line through the existing queued send (window.sendChat).
import { api } from '../../api.js';
import { mountSecureAccessDock, createSecureAccessContinuation } from './secure-access-core.js';

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
  return window.__promSecureAccessDock;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installDesktopSecureAccessDock, { once: true });
else installDesktopSecureAccessDock();
