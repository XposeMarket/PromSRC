import { openProtectedPluginCard, protectedRequestFromAction, protectedErrorText } from '../secure-access/protected-plugin-card.js';
import { el, ensureSecureAccessStyles, postJson } from '../secure-access/secure-access-core.js';

/** User-driven setup. Only the optional verification button sends a chat message. */
export async function openConnectFlow(fetchJson, target, options = {}) {
  ensureSecureAccessStyles();
  const previousFocus = document.activeElement;
  const root = el('div', { class: 'sa-connect-overlay' });
  const panel = el('section', { class: 'sa-card sa-connect', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Connect plugin', tabindex: '-1' });
  Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '10040', background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', padding: '18px', boxSizing: 'border-box' });
  Object.assign(panel.style, { background: 'var(--panel,var(--pm-surface,Canvas))', color: 'var(--text,var(--pm-text,CanvasText))', width: 'min(460px,100%)', padding: '22px', maxHeight: '85dvh', overflow: 'auto', overscrollBehavior: 'contain' });
  root.append(panel); (options.host || document.body).append(root); panel.focus();
  let attempt, card, timer; let busy = false, closed = false, stored = false, openingForm = false, handoffOpen = false;
  let handoffViewer, resumeAttemptId = target.attemptId;
  const title = () => attempt?.serviceName || target.name || target.serviceId;
  const close = () => {
    if (closed) return; closed = true; clearTimeout(timer); handoffViewer?.close(); card?.close(); root.remove();
    document.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', close);
    previousFocus?.focus?.(); options.onChanged?.();
  };
  function onKey(event) {
    if (handoffOpen) return;
    if (event.key === 'Escape') close();
    if (event.key !== 'Tab') return;
    const nodes = [...panel.querySelectorAll('button:not([disabled]),a[href],input,select,[tabindex="0"]')];
    if (!nodes.length) { event.preventDefault(); panel.focus(); return; }
    if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
  }
  document.addEventListener('keydown', onKey); window.addEventListener('hashchange', close);
  const text = (tag, value, cls) => { const node = el(tag, { text: value, class: cls }); panel.append(node); return node; };
  const button = (label, action, primary = false) => {
    const node = el('button', { type: 'button', class: `sa-btn${primary ? ' sa-pri' : ''}`, text: label }); panel.append(node);
    node.onclick = async () => { if (busy || closed) return; busy = true; node.disabled = true; try { await action(); } catch (error) { showError(error); } finally { busy = false; node.disabled = false; } };
    return node;
  };
  const showError = error => { if (!closed) text('p', protectedErrorText(error, 'Setup could not finish. Nothing was sent to chat. Close and retry, or check the plugin settings.'), 'sa-err'); };
  const act = async operation => {
    const result = await postJson(fetchJson, `/api/connection-attempts/${encodeURIComponent(attempt.id)}/${operation}`, {}, `Connect ${title()}`);
    attempt = result.attempt;
    if (operation === 'continue' && attempt.connectionId && attempt.state === 'registering' && attempt.plan?.strategy?.adapter === 'connector-oauth') {
      attempt = (await postJson(fetchJson, `/api/connection-attempts/${encodeURIComponent(attempt.id)}/verify`, {})).attempt;
    }
    await render(); options.onChanged?.();
  };
  const refresh = async () => { attempt = (await fetchJson(`/api/connection-attempts/${encodeURIComponent(attempt.id)}`)).attempt; await render(); };
  const ownerReady = async () => {
    const status = await fetchJson('/api/protected-plugins');
    if (status?.setup?.canConfigure ?? status?.owner?.canApprove) return true;
    panel.replaceChildren(); text('h2', 'Pair this device first');
    text('p', 'This device can view Prometheus, but it is not yet allowed to save account credentials.', 'sa-muted');
    text('p', 'Connect this device to your Prometheus using Settings → Pairing. An enabled paired device can save plugin credentials directly; no separate owner-approval permission is needed.', 'sa-muted');
    text('p', 'Alternatively, complete this connection in the Prometheus desktop app. No keys have been collected.', 'sa-muted');
    button('I’ve paired this device — retry', start, true); button('Close', close); return false;
  };
  const openOAuth = action => {
    const url = new URL(action.authorizationUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid authorization URL');
    if (window.openPrometheusExternalLink) window.openPrometheusExternalLink(url.href, { target: '_blank', features: 'noopener,noreferrer' });
    else window.open(url.href, '_blank', 'noopener,noreferrer');
  };
  const openPhoneOAuth = async () => {
    clearTimeout(timer);
    const { openMobileLoginHandoff } = await import('../../mobile/mobile-login-handoff.js');
    await act('continue');
    if (closed || attempt.state !== 'awaiting_oauth') return;
    clearTimeout(timer);
    const handoff = await postJson(fetchJson, `/api/connection-attempts/${encodeURIComponent(attempt.id)}/oauth-handoff`, {});
    if (closed) return;
    handoffOpen = true; root.style.display = 'none';
    handoffViewer = openMobileLoginHandoff('', handoff.sessionId, title(), { fetchJson, onClose: () => {
      handoffViewer = null; handoffOpen = false;
      if (!closed) { root.style.display = 'grid'; panel.focus(); act('continue').catch(showError); }
    } });
  };
  async function render() {
    if (closed || handoffOpen) return; clearTimeout(timer); panel.replaceChildren();
    const action = attempt.requiredUserAction;
    if (attempt.state === 'awaiting_secure_input') {
      if (openingForm) return; openingForm = true;
      const request = protectedRequestFromAction(attempt.serviceId, attempt.id, action);
      if (request || attempt.metadata?.protectedPluginSetup) {
        let saved = false;
        card = await openProtectedPluginCard(fetchJson, {
          host: panel, title: `Connect ${title()}`, embedded: true, serviceId: attempt.serviceId, attemptId: attempt.id,
          oauthApp: !!attempt.metadata?.protectedPluginSetup, request: request?.request,
          onClose: () => { if (!saved) close(); },
          onSaved: result => { saved = true; stored = !!result.stored; openingForm = false; queueMicrotask(() => {
            if (closed) return;
            if (result.attempt) { attempt = result.attempt; render().catch(showError); }
            else refresh().catch(showError);
          }); },
        });
        openingForm = false; if (closed) card.close(); return;
      }
      openingForm = false;
    }
    text('h2', title());
    if (action?.type === 'oauth' && attempt.state === 'awaiting_oauth') {
      const phone = window.matchMedia('(max-width: 767px)').matches;
      const phoneHandoff = action.desktopRequired && phone && !action.preferSystemBrowser;
      text('p', phoneHandoff ? 'Your app credentials are saved. Authorize your account here using the secure browser. No computer needed.' : action.desktopRequired && phone ? 'This provider requires system-browser sign-in.' : 'Continue to the provider to sign in and choose access.', 'sa-muted');
      if (phoneHandoff) button(`Authorize ${title()} on this phone`, openPhoneOAuth, true);
      else if (!(action.desktopRequired && phone)) button(`Sign in with ${title()}`, () => openOAuth(action), true);
      button('Check sign-in', () => act('continue'));
      timer = setTimeout(() => { if (!busy && !closed && !handoffOpen) act('continue').catch(showError); }, 2500);
    } else if (attempt.state === 'connected' || stored || (attempt.connectionId && ['degraded', 'registering', 'verifying'].includes(attempt.state))) {
      text('p', attempt.state === 'connected' ? 'Connected. You’re ready to use this plugin.' : 'Saved. Setup is complete, but access has not been fully verified.', 'sa-muted');
      if (typeof options.onVerify === 'function') button('Ask Prom to verify', () => {
        const message = `I just ${attempt.state === 'connected' ? 'connected' : 'set up'} the ${title()} plugin (${target.kind || 'plugin'}:${attempt.serviceId}). Please verify its connection and available features using safe, read-only checks. Do not post, send, or spend.`;
        close(); options.onVerify(message);
      });
    } else if (attempt.state === 'failed' || attempt.state === 'research_required' || attempt.state === 'reauth_required') {
      text('p', 'This plugin needs additional setup. No credentials were sent to chat.', 'sa-muted');
      if (attempt.error?.code === 'DISCOVERY_FAILED') text('p', 'Its installed definition does not provide a supported connection method. Check this plugin’s setup instructions.', 'sa-muted');
      else if (attempt.error) showError(attempt.error);
      if (attempt.plan?.strategy?.adapter === 'connector-oauth') button('Restart authorization', async () => { await act('cancel'); resumeAttemptId = undefined; return start(); }, true);
    } else if (action) {
      text('p', action.instructions || action.completionHint || action.label || 'Complete the plugin’s setup.', 'sa-muted');
      button('Check setup', () => act('continue'), true);
    } else text('p', attempt.state === 'cancelled' ? 'Connection cancelled.' : 'Preparing connection…', 'sa-muted');
    if (!['connected', 'failed', 'cancelled'].includes(attempt.state) && !stored) button('Cancel setup', async () => { await act('cancel'); close(); });
    button('Done', close);
  }
  async function start() {
    if (closed) return; panel.replaceChildren(); text('p', 'Opening setup…', 'sa-muted');
    try {
      if (!await ownerReady() || closed) return;
      attempt = resumeAttemptId
        ? (await fetchJson(`/api/connection-attempts/${encodeURIComponent(resumeAttemptId)}`)).attempt
        : (await fetchJson('/api/connection-attempts/start', { method: 'POST', body: JSON.stringify({ ...target, attemptId: undefined }) })).attempt;
      if (!attempt?.id || attempt.serviceId !== target.serviceId || (resumeAttemptId && attempt.id !== resumeAttemptId)) throw new Error('PROTECTED_REQUEST_UNAVAILABLE');
      if (attempt.state === 'awaiting_approval') {
        attempt = (await postJson(fetchJson, `/api/connection-attempts/${encodeURIComponent(attempt.id)}/prepare-input`, {})).attempt;
        if (attempt.state === 'awaiting_approval') {
          await act('connect'); return;
        }
      }
      await render();
    } catch (error) { if (!closed) { panel.replaceChildren(); text('h2', 'Unable to open setup'); showError(error); button('Retry', start); button('Close', close); } }
  }
  await start();
  return { close };
}
