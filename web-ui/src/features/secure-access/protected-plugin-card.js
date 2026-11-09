import { el, ensureSecureAccessStyles, postJson, secureAccessErrorText, OWNER_SURFACE_MESSAGE } from './secure-access-core.js';

// Shared protected plugin entry card (desktop, web, mobile, Settings, Connections, chat cards).
// Only native inputs hold values: never dataset, storage, polling, events, errors or chat.
// Every message below is fixed text; server errors are mapped by code, never echoed.

const X_FIELDS = Object.freeze([
  { key: 'clientId', label: 'OAuth 2.0 Client ID (not API Key / Consumer Key)', secret: false, required: true },
  { key: 'clientSecret', label: 'OAuth 2.0 Client Secret (optional, not API Secret Key)', secret: true, required: false },
]);
const X_AUTH_HOSTS = new Set(['twitter.com', 'x.com']);

export const PROTECTED_ERROR_TEXT = Object.freeze({
  OWNER_SURFACE_REQUIRED: OWNER_SURFACE_MESSAGE,
  PROTECTED_STORAGE_REQUIRED: 'Protected storage is unavailable on this computer. Nothing was collected.',
  UNSUPPORTED_PLUGIN: 'This plugin does not support protected key entry yet. Nothing was collected.',
  PROTECTED_REQUEST_UNAVAILABLE: 'Could not start protected entry for this plugin. Nothing was collected.',
  REQUEST_EXPIRED: 'This entry expired and its fields were cleared. Start again to retry.',
  INVALID_AUTH_URL: 'X sign-in link was not an official X address, so it was not opened. Your app values are stored; nothing is connected yet.',
  OAUTH_UNAVAILABLE: 'Stored, but X sign-in could not start. Use Reconnect in Saved access to retry.',
  SAVE_FAILED: 'Not saved. The fields were cleared; re-enter the values to retry. Nothing was sent through chat.',
});

/** Pure: error -> fixed user text. Never includes the error message itself. */
export function protectedErrorText(error, fallback = PROTECTED_ERROR_TEXT.SAVE_FAILED) {
  const raw = String(error?.message || error || '');
  const code = Object.keys(PROTECTED_ERROR_TEXT).find(key => raw.includes(key));
  if (code) return PROTECTED_ERROR_TEXT[code];
  return secureAccessErrorText(error, fallback);
}

/** Pure: only official HTTPS X authorization URLs are allowed. */
export function safeXAuthUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    const host = url.hostname.replace(/^www\./, '');
    return X_AUTH_HOSTS.has(host) ? url.href : '';
  } catch { return ''; }
}

/** Pure: normalize a connector secure-input action into the card's request shape (metadata only). */
export function protectedRequestFromAction(serviceId, attemptId, action) {
  if (!action || action.type !== 'secure-input' || !action.credentialSessionId) return null;
  return {
    serviceId: String(serviceId || ''),
    request: { id: String(action.credentialSessionId), attemptId: String(attemptId || ''), fields: Array.isArray(action.fields) ? action.fields.map(f => ({ key: String(f.key || ''), label: String(f.label || f.key || ''), secret: f.secret !== false, required: f.required !== false })) : [], expiresAt: action.expiresAt || '' },
  };
}

let openCard = null;

export async function openProtectedPluginCard(fetchJson, options = {}) {
  ensureSecureAccessStyles();
  openCard?.close();
  const parent = options.host || document.body;
  const root = el('section', { class: 'sa-card', role: 'dialog', 'aria-label': 'Protected plugin entry', 'data-protected-plugin-card': 'true' });
  if (!options.host) Object.assign(root.style, { position: 'fixed', zIndex: '10050', left: '50%', top: '12%', transform: 'translateX(-50%)', width: 'min(460px,92vw)', maxHeight: '75dvh', overflow: 'auto', background: 'var(--prom-surface,Canvas)' });
  if (options.embedded) Object.assign(root.style, { padding: '0', border: '0', background: 'transparent', maxWidth: 'none' });
  parent.append(root);
  const inputs = [];
  let closed = false;
  let expiryTimer = null;
  const clear = () => inputs.forEach(input => { input.value = ''; });
  // App switching is not cancellation. Values remain only in mounted native inputs.
  let hiddenAt = 0;
  let hiddenTimer = null;
  const onHide = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now(); clearTimeout(hiddenTimer);
      hiddenTimer = setTimeout(close, 5 * 60 * 1000);
    } else {
      clearTimeout(hiddenTimer);
      if (hiddenAt && Date.now() - hiddenAt >= 5 * 60 * 1000) close();
      hiddenAt = 0;
    }
  };
  function close() {
    if (closed) return;
    closed = true; clear(); inputs.length = 0; clearTimeout(expiryTimer); clearTimeout(hiddenTimer);
    root.remove();
    window.removeEventListener('pagehide', close); window.removeEventListener('hashchange', close); document.removeEventListener('visibilitychange', onHide);
    if (openCard?.close === close) openCard = null;
    options.onClose?.();
  }
  const handle = { close, get closed() { return closed; } };
  openCard = handle;
  window.addEventListener('pagehide', close); window.addEventListener('hashchange', close); document.addEventListener('visibilitychange', onHide);
  root.append(el('h3', { text: options.title || 'Add secret · protected entry' }), el('p', { class: 'sa-muted', text: 'Values go directly to this plugin’s protected storage, not the conversation, drafts or the model. Saving does not authorize posting or spending.' }));
  const error = el('p', { class: 'sa-err', role: 'alert' });
  const status = el('p', { class: 'sa-muted', role: 'status', 'aria-live': 'polite' });
  root.append(error, status, el('button', { class: 'sa-btn', type: 'button', text: 'Cancel', onclick: close }));
  const fail = (code) => { clear(); error.textContent = protectedErrorText(code); };
  try {
    const [st, catalog] = await Promise.all([fetchJson('/api/secure-access/status'), fetchJson('/api/protected-plugins')]);
    if (closed) return handle;
    // Fail closed before any input exists.
    if (!(catalog?.setup?.canConfigure ?? (st?.owner?.canApprove && catalog?.owner?.canApprove !== false))) { fail('OWNER_SURFACE_REQUIRED'); return handle; }
    if (!catalog?.storageAvailable) { fail('PROTECTED_STORAGE_REQUIRED'); return handle; }
    const services = Array.isArray(catalog.services) ? catalog.services : [];
    const selector = el('select', { class: 'sa-input', 'aria-label': 'Destination plugin' });
    const known = new Set();
    for (const item of services) { known.add(String(item.id)); selector.append(el('option', { value: String(item.id), text: String(item.name || item.id) })); }
    if (!known.has('x')) selector.append(el('option', { value: 'x', text: 'X (OAuth app)' }));
    const wanted = String(options.serviceId || (services[0]?.id ?? 'x'));
    if (!known.has(wanted) && wanted !== 'x') selector.append(el('option', { value: wanted, text: wanted }));
    selector.value = wanted;
    if (options.request || options.attemptId) selector.disabled = true;
    const form = el('form', { class: 'sa-form', autocomplete: 'off', novalidate: true });
    if (!options.serviceId) root.insertBefore(el('label', { class: 'sa-field' }, el('span', { class: 'sa-lbl', text: 'Destination plugin' }), selector), error);
    root.insertBefore(form, error);
    async function render() {
      clear(); inputs.length = 0; form.replaceChildren(); error.textContent = ''; status.textContent = ''; clearTimeout(expiryTimer);
      const service = selector.value;
      const nativeApp = !!options.oauthApp && !!options.attemptId;
      let request = nativeApp ? await fetchJson(`/api/protected-plugins/app-schema/${encodeURIComponent(options.attemptId)}`) : service === 'x' ? null : options.request || null;
      if (nativeApp && request.serviceId !== service) throw new Error('UNSUPPORTED_PLUGIN');
      if (!nativeApp && service !== 'x' && !request) request = (await postJson(fetchJson, '/api/protected-plugins/request', { serviceId: service }))?.request || null;
      if (closed) return;
      const fields = nativeApp ? request.fields : service === 'x' ? X_FIELDS : Array.isArray(request?.fields) ? request.fields : [];
      if (!fields.length || (!nativeApp && service !== 'x' && (!request?.id || !request?.attemptId))) throw new Error('UNSUPPORTED_PLUGIN');
      const expires = Date.parse(request?.expiresAt || '');
      if (expires) {
        const left = expires - Date.now();
        if (left <= 0) throw new Error('REQUEST_EXPIRED');
        expiryTimer = setTimeout(() => { clear(); form.replaceChildren(); fail('REQUEST_EXPIRED'); }, Math.min(left, 2 ** 31 - 1));
      }
      for (const field of fields) {
        const input = el('input', { class: 'sa-input', type: field.secret === false ? 'text' : 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'data-prom-secret': 'true', required: field.required === true, 'aria-label': String(field.label || field.key) });
        inputs.push(input); form.append(el('label', { class: 'sa-field' }, el('span', { class: 'sa-lbl', text: String(field.label || field.key) }), input));
      }
      const save = el('button', { class: 'sa-btn sa-pri', type: 'submit', text: nativeApp || service === 'x' ? 'Save and continue to sign-in' : 'Save key' });
      form.append(save);
      inputs[0]?.focus?.();
      form.onsubmit = async event => {
        event.preventDefault();
        if (fields.some((field, i) => field.required === true && !inputs[i].value.trim())) { error.textContent = 'Fill the required field.'; return; }
        save.disabled = true; error.textContent = '';
        let values = Object.fromEntries(fields.map((field, i) => [field.key, inputs[i].value.trim()]));
        clear();
        try {
          if (nativeApp || service === 'x') {
            const body = { clientId: values.clientId, clientSecret: values.clientSecret, ...(options.attemptId ? { attemptId: options.attemptId } : {}), ...(service !== 'x' ? { id: service } : {}) };
            values = null;
            try {
              if (service === 'x') await postJson(fetchJson, '/api/auth/x-api/credentials', body, 'Save X OAuth app credentials');
              else await postJson(fetchJson, '/api/connections/credentials', body, 'Save OAuth app credentials');
            }
            finally { body.clientId = ''; body.clientSecret = ''; }
            let next;
            if (options.attemptId) {
              next = await postJson(fetchJson, `/api/connection-attempts/${encodeURIComponent(options.attemptId)}/continue`, {});
              options.onSaved?.({ serviceId: service, attempt: next.attempt });
              close(); return;
            }
            try { next = await postJson(fetchJson, '/api/auth/x-api/start', {}); } catch { throw new Error('OAUTH_UNAVAILABLE'); }
            const href = safeXAuthUrl(next?.authUrl || next?.auth_url);
            if (!next?.authUrl && !next?.auth_url) throw new Error('OAUTH_UNAVAILABLE');
            if (!href) throw new Error('INVALID_AUTH_URL');
            const link = el('a', { class: 'sa-btn sa-pri', href, target: '_blank', rel: 'noopener noreferrer', text: 'Continue on X to authorize' });
            link.addEventListener('click', ev => { if (typeof window.openPrometheusExternalLink === 'function') { ev.preventDefault(); window.openPrometheusExternalLink(href, { target: '_blank', features: 'noopener,noreferrer' }); } });
            form.replaceChildren(el('p', { class: 'sa-muted', text: 'App stored. Not connected yet: finish sign-in on X, then check Saved access.' }), link);
          } else {
            const body = { values };
            values = null;
            let result;
            try { result = await postJson(fetchJson, `/api/connection-secure-input/${encodeURIComponent(request.id)}`, body, 'Save plugin key to protected storage'); }
            finally { for (const key of Object.keys(body.values)) body.values[key] = ''; }
            // Bindable plugin keys finish continuation server-side and return metadata only (no credentialRef),
            // so the UI never replays a ref. Only the non-bindable legacy path still returns a ref to continue with.
            if (result?.credentialRef) await postJson(fetchJson, `/api/connection-attempts/${encodeURIComponent(request.attemptId)}/continue`, { credentialRef: result.credentialRef });
            clearTimeout(expiryTimer);
            if (options.onSaved) { options.onSaved({ serviceId: service, stored: true }); close(); return; }
            form.replaceChildren(el('p', { class: 'sa-muted', text: result?.status === 'STORED_CONNECTION_PENDING' ? 'Key stored. Connection setup is pending; do not re-enter the key. Retry from Connections.' : 'Stored, not verified. Prometheus has no safe check for this key; saving alone does not mean connected.' }));
          }
          options.onSaved?.({ serviceId: service });
        } catch (err) { fail(err); }
        finally { if (values) for (const key of Object.keys(values)) values[key] = ''; values = null; save.disabled = false; }
      };
    }
    selector.onchange = () => render().catch(err => fail(err));
    await render();
  } catch (err) { if (!closed) fail(/OWNER_|PROTECTED_|UNSUPPORTED|EXPIRED/.test(String(err?.message || err)) ? err : 'PROTECTED_REQUEST_UNAVAILABLE'); }
  return handle;
}
