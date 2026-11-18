// Needs You on the Tasks page: mount the SAME protected cards chat uses for
// saved-access (password) requests, protected sign-in approvals and plugin
// connection setup. Values go straight to the protected endpoints; the Tasks
// page and the model never see them. Owner-proof rules are enforced server-side.
import { mountPendingLoginCard, mountSecureAccessCard, secureAccessContinuationText, SECURE_ACCESS_API } from '../secure-access/secure-access-core.js';
import { renderConnectionChatCards, wireConnectionChatCards } from '../connectors/connection-chat-card.js';

export const TASK_SECURE_KINDS = new Set(['secure_access', 'secure_login', 'connection_setup']);

export function taskSecureHostHtml(entry, esc) {
  return `<div class="task-ny-secure" data-ny-secure-host="${esc(String(entry.id || ''))}" style="min-width:0"></div>`;
}

let statusPromise = null;
function secureStatus(fetchJson) {
  if (!statusPromise) statusPromise = Promise.resolve(fetchJson(`${SECURE_ACCESS_API}/status`)).catch(() => { statusPromise = null; return {}; });
  return statusPromise;
}

/**
 * Mount cards into empty hosts. Already-mounted hosts are kept (preserveRequestCards
 * keeps the node across refreshes), so typed values are never re-rendered away.
 * onContinue(sessionId, text) lets Prom continue in the originating chat.
 */
export async function mountTaskSecureCards(root, entries, { fetchJson, onContinue } = {}) {
  if (!root || typeof fetchJson !== 'function') return;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!TASK_SECURE_KINDS.has(entry?.kind)) continue;
    const host = [...root.querySelectorAll('[data-ny-secure-host]')].find(el => el.dataset.nySecureHost === entry.id);
    if (!host || host.dataset.mounted === 'true') continue;
    host.dataset.mounted = 'true';
    const payload = entry.item?.payload || {};
    const sessionId = String(entry.sessionId || payload.sessionId || '');
    const resolved = (meta = {}) => {
      if (!meta || meta.status === 'expired' || meta.local === false) return;
      try { onContinue?.(sessionId, secureAccessContinuationText(meta), meta); } catch { /* metadata only */ }
    };
    try {
      if (entry.kind === 'secure_access') {
        const status = await secureStatus(fetchJson);
        if (!host.isConnected) continue;
        mountSecureAccessCard(host, { request: payload, status: status || {}, fetchJson, onResolved: resolved });
      } else if (entry.kind === 'secure_login') {
        mountPendingLoginCard(host, { credential: payload, fetchJson, onResolved: resolved });
      } else {
        host.innerHTML = renderConnectionChatCards({ artifacts: [{ type: 'connection_card', attempt: payload }] });
        wireConnectionChatCards(host, fetchJson);
      }
    } catch (error) {
      host.dataset.mounted = '';
      console.warn('[Tasks] protected card unavailable:', error);
    }
  }
}
