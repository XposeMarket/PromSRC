import { openConnectFlow } from './connect-flow.js';
import { ensureSecureAccessStyles } from '../secure-access/secure-access-core.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** Render metadata only. Credentials and authorization actions are fetched after a user tap. */
export function renderConnectionChatCards(message) {
  const list = key => Array.isArray(message?.[key]) ? message[key] : Array.isArray(message?.metadata?.[key]) ? message.metadata[key] : [];
  const artifacts = [...list('artifacts'), ...list('richArtifacts')];
  const seen = new Set();
  return artifacts.filter(a => a?.type === 'connection_card').map(artifact => {
    const attempt = artifact.attempt;
    if (!attempt?.id || !attempt.serviceId || seen.has(attempt.id)) return '';
    seen.add(attempt.id);
    return `<section class="sa-card" data-connection-chat-card><h3>${escape(attempt.serviceName || attempt.serviceId)}</h3><p>Open protected setup to enter credentials or check this connection. Values are never sent through chat.</p><button type="button" class="sa-btn sa-pri" data-connection-attempt="${escape(attempt.id)}" data-connection-service="${escape(attempt.serviceId)}">Open setup</button><p role="status" data-connection-status></p></section>`;
  }).join('');
}

export function wireConnectionChatCards(host, fetchJson) {
  if (host.querySelector('[data-connection-chat-card]')) ensureSecureAccessStyles();
  host.querySelectorAll('[data-connection-attempt]').forEach(button => {
    if (button.dataset.connectionWired) return;
    button.dataset.connectionWired = 'true';
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      const status = button.closest('[data-connection-chat-card]')?.querySelector('[data-connection-status]');
      if (status) status.textContent = '';
      try {
        await openConnectFlow(fetchJson, { serviceId: button.dataset.connectionService, attemptId: button.dataset.connectionAttempt });
      } catch {
        if (status) status.textContent = 'Unable to open protected setup. Retry from Plugins.';
      } finally { button.disabled = false; }
    });
  });
}
