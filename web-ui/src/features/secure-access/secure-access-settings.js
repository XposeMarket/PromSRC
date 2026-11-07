// "Saved access" settings panel shared by desktop/web Settings > Security and
// mobile Settings > Security. Metadata only: no API here returns stored values.
import {
  SECURE_ACCESS_API, ensureSecureAccessStyles, el, lockIcon, postJson,
  storageLabel, isExactHttpsOriginUrl, mountSecureAccessCard, secureAccessErrorText, ownerSurfaceBanner,
} from './secure-access-core.js';
import { mountProtectedPluginSaved } from './protected-plugin-settings.js';

const KIND_LABEL = { login: 'Login', api_key: 'API key', otp: 'One-time code' };

function fmtTime(value) {
  const t = Date.parse(value || '');
  return t ? new Date(t).toLocaleString() : '—';
}

/**
 * Mount Saved access management. opts: { fetchJson, confirm(message) -> Promise<boolean>, sessionId? }
 * Returns { refresh(), destroy() }.
 */
export function mountSavedAccessSettings(host, opts = {}) {
  ensureSecureAccessStyles();
  const fetchJson = opts.fetchJson;
  const confirmFn = opts.confirm || ((msg) => Promise.resolve(globalThis.confirm ? globalThis.confirm(msg) : false));
  const cards = new Set();
  let destroyed = false;
  let status = null;

  const statusLine = el('p', { class: 'sa-muted' });
  const ownerHost = el('div', { 'data-sa-owner-host': 'true' });
  const msgLine = el('p', { class: 'sa-muted', role: 'status', 'aria-live': 'polite' });
  const list = el('div', { style: 'display:grid;gap:10px' });
  const addHost = el('div', { style: 'display:grid;gap:10px' });
  const addBtn = el('button', { type: 'button', class: 'sa-btn sa-pri', text: 'Add saved access' });
  const root = el('div', { class: 'sa-settings', 'data-secure-access-settings': 'true' },
    el('div', { class: 'sa-card' },
      el('div', { class: 'sa-hd' }, lockIcon(20), el('div', { style: 'display:grid;gap:2px' },
        el('h3', { text: 'Saved access' }),
        el('p', { text: 'Sign-ins and keys Prom can use for you on exact sites. Prom never sees the values, and posting, sending or buying still asks you separately.' }))),
      statusLine, ownerHost, el('div', { class: 'sa-row' }, addBtn), addHost, msgLine),
    list);
  const pluginHost = el('div', { 'data-protected-plugin-host': 'true' });
  root.append(pluginHost);
  host.replaceChildren(root);
  const pluginKeys = mountProtectedPluginSaved(pluginHost, { fetchJson, confirm: confirmFn });

  const say = (text, tone = '') => { msgLine.textContent = text; msgLine.className = `sa-muted ${tone}`; };
  const fail = (error) => say(secureAccessErrorText(error, 'That did not work. Refresh and try again.'), 'sa-err');

  function showCard(request) {
    const card = mountSecureAccessCard(addHost, {
      request, status: status || {}, fetchJson,
      onResolved: () => { setTimeout(() => { card.destroy(); cards.delete(card); }, 4000); refresh(); },
    });
    cards.add(card);
  }

  addBtn.addEventListener('click', () => {
    if (addHost.querySelector('form[data-sa-add]')) return;
    const label = el('input', { class: 'sa-input', id: 'sa-add-label', autocomplete: 'off', placeholder: 'e.g. Resend' });
    const origin = el('input', { class: 'sa-input', id: 'sa-add-origin', type: 'url', autocomplete: 'off', placeholder: 'https://example.com', inputmode: 'url' });
    const mode = el('select', { class: 'sa-input', id: 'sa-add-mode' },
      el('option', { value: 'existing', text: 'Existing login' }),
      el('option', { value: 'new', text: 'New account password' }),
      el('option', { value: 'api_key', text: 'API key' }));
    const err = el('p', { class: 'sa-err', role: 'alert' });
    const form = el('form', { class: 'sa-form', 'data-sa-add': 'true', novalidate: true },
      el('label', { class: 'sa-field', for: label.id }, el('span', { class: 'sa-lbl', text: 'Name' }), label),
      el('label', { class: 'sa-field', for: origin.id }, el('span', { class: 'sa-lbl', text: 'Exact site (HTTPS origin)' }), origin),
      el('label', { class: 'sa-field', for: mode.id }, el('span', { class: 'sa-lbl', text: 'Type' }), mode),
      err,
      el('div', { class: 'sa-row' },
        el('button', { type: 'submit', class: 'sa-btn sa-pri', text: 'Continue' }),
        el('button', { type: 'button', class: 'sa-btn', text: 'Cancel', onclick: () => form.remove() })));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      let originValue = '';
      try { const u = new URL(origin.value.trim()); if (u.protocol === 'https:') originValue = u.origin; } catch { /* invalid */ }
      if (!label.value.trim()) { err.textContent = 'Add a name.'; return; }
      if (!originValue) { err.textContent = 'Use an https:// site address.'; return; }
      try {
        const res = await postJson(fetchJson, `${SECURE_ACCESS_API}/requests`, {
          label: label.value.trim(), purpose: 'Added from Settings', origin: originValue, mode: mode.value,
        });
        form.remove();
        if (res?.request) showCard(res.request);
      } catch (error) { err.textContent = secureAccessErrorText(error, 'Could not start. Try again.'); }
    });
    addHost.prepend(form);
    label.focus();
  });

  function renderCredential(cred) {
    const panel = el('div', { class: 'sa-panel', hidden: true });
    const isMain = Array.isArray(cred.grants) && cred.grants.includes('main');
    const revoked = String(cred.state || '') === 'revoked';
    const btn = (text, fn, cls = '') => el('button', { type: 'button', class: `sa-btn sa-sm ${cls}`, text, onclick: fn });
    const run = async (fn, okText) => {
      try { await fn(); say(okText, 'sa-ok'); refresh(); } catch (error) { fail(error); }
    };

    const actions = el('div', { class: 'sa-row' },
      btn('Replace', () => run(async () => {
        const res = await postJson(fetchJson, `${SECURE_ACCESS_API}/credentials/${encodeURIComponent(cred.id)}/replace`, {});
        if (res?.request) showCard(res.request);
      }, 'Enter the new value below. The old one stays until the new one is confirmed.')),
      revoked || !isMain
        ? btn('Allow main Prom', () => run(() => postJson(fetchJson, `${SECURE_ACCESS_API}/credentials/${encodeURIComponent(cred.id)}/grants`, { grants: ['main'] }), 'Main Prom can use this again.'))
        : btn('Revoke', () => run(() => postJson(fetchJson, `${SECURE_ACCESS_API}/credentials/${encodeURIComponent(cred.id)}/revoke`, {}), 'Revoked. The value is kept but nobody can use it.')),
      btn('History', () => showAudit()),
      cred.kind === 'login' && !revoked ? btn('Sign in…', () => showLogin()) : null,
      btn('Delete', async () => {
        const ok = await confirmFn(`Delete saved access "${cred.label}"? This removes it from Prometheus only. It does not sign you out of ${cred.origin} or delete that account.`);
        if (ok) run(() => postJson(fetchJson, `${SECURE_ACCESS_API}/credentials/${encodeURIComponent(cred.id)}/delete`, { confirm: true }), 'Deleted from Prometheus.');
      }, 'sa-danger'));

    async function showAudit() {
      panel.hidden = false;
      panel.replaceChildren(el('p', { class: 'sa-muted', text: 'Loading history…' }));
      try {
        const res = await fetchJson(`${SECURE_ACCESS_API}/credentials/${encodeURIComponent(cred.id)}/audit`);
        const events = Array.isArray(res?.events) ? res.events : [];
        panel.replaceChildren(events.length
          ? el('ul', { class: 'sa-sum' }, events.slice(-50).reverse().map((e) => el('li', { text: `${fmtTime(e.at)} · ${e.action || ''} · ${e.actor || ''} · ${e.outcome || ''}` })))
          : el('p', { class: 'sa-muted', text: 'No history yet.' }));
      } catch { panel.replaceChildren(el('p', { class: 'sa-err', text: 'Could not load history.' })); }
    }

    function showLogin() {
      panel.hidden = false;
      const url = el('input', { class: 'sa-input', type: 'url', id: `sa-login-${cred.id}`, autocomplete: 'off', placeholder: `${cred.origin}/login`, inputmode: 'url' });
      const err = el('p', { class: 'sa-err', role: 'alert' });
      const step = el('div', { style: 'display:grid;gap:8px' });
      const prepare = el('button', { type: 'button', class: 'sa-btn sa-sm sa-pri', text: 'Prepare sign-in' });
      prepare.addEventListener('click', async () => {
        err.textContent = '';
        if (!isExactHttpsOriginUrl(url.value.trim(), cred.origin)) { err.textContent = `Use a sign-in page on exactly ${cred.origin}.`; return; }
        try {
          const res = await postJson(fetchJson, `${SECURE_ACCESS_API}/credentials/${encodeURIComponent(cred.id)}/login/prepare`, { url: url.value.trim(), sessionId: (typeof opts.getSessionId === 'function' && opts.getSessionId()) || 'main' });
          if (res?.phase !== 'ready') { err.textContent = 'This sign-in page is not supported. Sign in yourself in the browser.'; return; }
          renderApprove(res);
        } catch (error) { err.textContent = secureAccessErrorText(error, 'This sign-in page is not supported or the browser is unavailable. Sign in yourself in the browser.'); }
      });
      function renderApprove(res) {
        const filled = Array.isArray(res.filled) ? res.filled.join(' and ') : 'fields';
        step.replaceChildren(
          el('p', { class: 'sa-muted', text: `Ready on ${res.origin || cred.origin}: ${filled} filled in a protected page. This approves signing in only.` }),
          el('div', { class: 'sa-row' },
            el('button', { type: 'button', class: 'sa-btn sa-sm sa-pri', text: 'Approve sign-in', onclick: async () => {
              try {
                const out = await postJson(fetchJson, `${SECURE_ACCESS_API}/credentials/${encodeURIComponent(cred.id)}/login/submit`, { confirm: true });
                renderOutcome(out);
              } catch (error) { err.textContent = secureAccessErrorText(error, 'Sign-in could not be sent.'); }
            } }),
            el('button', { type: 'button', class: 'sa-btn sa-sm', text: 'Cancel', onclick: async () => {
              try { await postJson(fetchJson, `${SECURE_ACCESS_API}/credentials/${encodeURIComponent(cred.id)}/login/cancel`, {}); } catch { /* best effort */ }
              panel.hidden = true; panel.replaceChildren();
            } })));
      }
      function renderOutcome(out) {
        const outcome = (verified) => run(() => postJson(fetchJson, `${SECURE_ACCESS_API}/credentials/${encodeURIComponent(cred.id)}/outcome`, { verified }), verified ? 'Marked as working.' : 'Marked as not working. Replace it when ready.');
        step.replaceChildren(
          el('p', { class: 'sa-muted', text: out?.transferred === false ? 'Sign-in was not sent. Nothing changed.' : 'Sign-in sent. The result is unknown until you check the site.' }),
          el('div', { class: 'sa-row' },
            el('button', { type: 'button', class: 'sa-btn sa-sm', text: 'It worked', onclick: () => outcome(true) }),
            el('button', { type: 'button', class: 'sa-btn sa-sm', text: 'It did not work', onclick: () => outcome(false) })));
      }
      step.replaceChildren(el('label', { class: 'sa-field', for: url.id }, el('span', { class: 'sa-lbl', text: 'Sign-in page' }), url), el('div', { class: 'sa-row' }, prepare));
      panel.replaceChildren(step, err);
    }

    return el('div', { class: 'sa-card', 'data-credential-id': cred.id },
      el('div', { class: 'sa-hd' }, el('div', { style: 'display:grid;gap:4px;min-width:0;flex:1' },
        el('h3', { text: cred.label || cred.origin || 'Saved access' }),
        el('p', { text: `${cred.origin || ''}${cred.identifier ? ` · ${cred.identifier}` : ''}` }),
        el('div', { class: 'sa-cred-meta' },
          el('span', { class: 'sa-badge', text: KIND_LABEL[cred.kind] || 'Access' }),
          el('span', { class: 'sa-badge', text: revoked ? 'Revoked' : (cred.state || 'active') }),
          el('span', { class: 'sa-badge', text: isMain && !revoked ? 'Main Prom only' : 'No agent access' }),
          cred.pendingLogin ? el('span', { class: 'sa-badge sa-warn', text: `Sign-in waiting${cred.loginOrigin ? ` · ${cred.loginOrigin}` : ''}` }) : null),
        el('p', { text: `${storageLabel(cred.storage)} · Last used ${fmtTime(cred.lastUsedAt)}` }))),
      actions, panel);
  }

  async function refresh() {
    if (destroyed) return;
    try {
      const [st, res] = await Promise.all([
        fetchJson(`${SECURE_ACCESS_API}/status`).catch(() => null),
        fetchJson(`${SECURE_ACCESS_API}/credentials`),
      ]);
      if (destroyed) return;
      status = st;
      // Fail closed: surfaces without owner proof cannot add/change access, only revoke it.
      const banner = ownerSurfaceBanner(st);
      ownerHost.replaceChildren(...(banner ? [banner] : []));
      addBtn.disabled = !!banner;
      addBtn.title = banner ? 'Available in the Prometheus desktop app or on a paired phone' : '';
      statusLine.textContent = st?.persistentAllowed
        ? 'Remembered access is encrypted with this computer\'s protected key store. Programs already running as you on this computer are not blocked by it.'
        : 'This computer has no protected key store, so access is kept in memory only and cleared when Prometheus restarts.';
      const creds = Array.isArray(res?.credentials) ? res.credentials : [];
      list.replaceChildren(...(creds.length ? creds.map(renderCredential) : [el('p', { class: 'sa-muted', text: 'No saved access yet.' })]));
    } catch {
      list.replaceChildren(el('p', { class: 'sa-err', text: 'Saved access is unavailable right now.' }));
    }
  }
  refresh();

  return {
    refresh() { pluginKeys.refresh(); return refresh(); },
    /** Wipe any open protected cards (e.g. when Settings leaves this tab). */
    clearDrafts() { for (const card of cards) card.destroy(); cards.clear(); },
    destroy() {
      destroyed = true;
      pluginKeys.destroy();
      for (const card of cards) card.destroy();
      cards.clear();
      host.replaceChildren();
    },
  };
}
