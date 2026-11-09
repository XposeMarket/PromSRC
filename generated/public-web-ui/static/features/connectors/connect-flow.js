import { openProtectedPluginCard, protectedRequestFromAction } from '../secure-access/protected-plugin-card.js';
import { postJson } from '../secure-access/secure-access-core.js';

/** Shared metadata-only connection actions. Secret forms stay in the protected card. */
export async function openConnectFlow(fetchJson, target, options = {}) {
  const root = document.createElement('div'); root.className = 'sa-overlay';
  const panel = document.createElement('section'); panel.className = 'sa-card'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Connect plugin');
  Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '10040', background: 'rgba(0,0,0,.35)', display: 'grid', alignItems: 'center', justifyItems: 'center', padding: '18px' });
  Object.assign(panel.style, { background: 'var(--panel, Canvas)', color: 'var(--text, CanvasText)', boxSizing: 'border-box', width: 'min(460px,calc(100vw - 36px))', padding: '24px', borderRadius: '18px', maxHeight: '80dvh', overflow: 'auto' });
  root.append(panel); (options.host || document.body).append(root);
  let attempt; let busy = false; let closed = false;
  const close = () => { closed = true; root.remove(); options.onChanged?.(); };
  const text = (tag, value) => { const node = document.createElement(tag); node.textContent = value; panel.append(node); return node; };
  const button = (label, action) => {
    const node = text('button', label); node.className = 'sa-btn'; node.type = 'button';
    node.onclick = async () => { if (busy) return; busy = true; node.disabled = true; try { await action(); } catch (error) { text('p', error?.message || 'Connection action failed.'); } finally { busy = false; node.disabled = false; } };
  };
  const apply = result => { attempt = result?.attempt || result; render(); };
  const act = async operation => {
    const path = `/api/connection-attempts/${encodeURIComponent(attempt.id)}/${operation}`;
    const result = await postJson(fetchJson, path, {}, `Connect ${attempt.serviceName || attempt.serviceId}`);
    apply(result); options.onChanged?.();
  };
  const refresh = async () => apply(await fetchJson(`/api/connection-attempts/${encodeURIComponent(attempt.id)}`));
  const render = () => {
    if (closed) return; panel.replaceChildren();
    text('h2', attempt.serviceName || attempt.serviceId); text('p', String(attempt.state || '').replaceAll('_', ' '));
    if (attempt.error) text('p', attempt.error.message || attempt.error.code);
    const action = attempt.requiredUserAction;
    if (attempt.state === 'awaiting_approval') { text('p', attempt.plan?.summary || 'Review this connection before continuing.'); button('Approve connection', () => act('connect')); }
    else if (attempt.state === 'awaiting_secure_input') {
      const request = protectedRequestFromAction(attempt.serviceId, attempt.id, action);
      if (request || attempt.metadata?.protectedPluginSetup) button('Open protected entry', () => openProtectedPluginCard(fetchJson, {
        serviceId: attempt.serviceId, attemptId: attempt.id, oauthApp: !!attempt.metadata?.protectedPluginSetup, request: request?.request,
        onSaved: result => result?.attempt ? apply(result) : refresh(),
      }));
    } else if (action?.type === 'oauth') {
      text('p', action.desktopRequired ? 'This provider returns to the PC. Complete sign-in there, then check here.' : 'Complete provider consent, then check here.');
      const phone = window.matchMedia('(max-width: 767px)').matches;
      if (action.desktopRequired && phone) text('p', 'Finish on your computer. Open this same connection there to continue; do not open the loopback sign-in on this phone.');
      else button(action.label || 'Open provider sign-in', () => {
        const url = new URL(action.authorizationUrl); if (url.protocol !== 'https:') throw new Error('Invalid provider authorization URL.');
        if (window.openPrometheusExternalLink) window.openPrometheusExternalLink(url.href, { target: '_blank', features: 'noopener,noreferrer' });
        else window.open(url.href, '_blank', 'noopener,noreferrer');
      });
      button('Check authorization', () => act('continue'));
    } else if (['registering', 'verifying', 'degraded'].includes(attempt.state)) button('Verify connection', () => act('verify'));
    else if (action) { text('p', action.instructions || action.completionHint || action.label || 'Complete the required setup.'); button('Check setup', () => act('continue')); }
    if (!['connected', 'failed', 'cancelled'].includes(attempt.state)) button('Cancel connection', () => act('cancel'));
    button('Close', close);
  };
  text('p', 'Loading connection…');
  try { apply(await fetchJson('/api/connection-attempts/start', { method: 'POST', body: JSON.stringify(target) })); }
  catch (error) { panel.replaceChildren(); text('h2', 'Connection unavailable'); text('p', error?.message || 'Could not start this connection.'); button('Close', close); }
  return { close };
}
