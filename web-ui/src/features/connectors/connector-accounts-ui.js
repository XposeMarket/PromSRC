// Multi-account section for a connected plugin (desktop connector view + mobile plugin sheet).
// Metadata only: labels/emails/usernames. Credentials never reach the UI.
import { el, ensureSecureAccessStyles, postJson } from '../secure-access/secure-access-core.js';

const CSS = `
.pa-accts{display:grid;gap:8px;margin:12px 0 4px;text-align:left}
.pa-accts-title{font-size:12px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;opacity:.6;margin:0 2px}
.pa-acct{display:flex;align-items:center;gap:10px;padding:11px 12px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:16px;min-width:0}
.pa-acct-dot{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;flex:none;font-weight:650;font-size:14px;background:color-mix(in srgb,currentColor 9%,transparent)}
.pa-acct-txt{display:grid;gap:1px;min-width:0;flex:1}.pa-acct-txt b{font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pa-acct-txt span{font-size:12px;opacity:.62}
.pa-acct-act{display:flex;gap:6px;flex:none}
.pa-mini{font:inherit;font-size:12px;padding:6px 10px;border-radius:999px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);background:transparent;color:inherit;cursor:pointer}
.pa-mini.danger{color:#e5484d;border-color:color-mix(in srgb,#e5484d 40%,transparent)}
.pa-add{font:inherit;font-size:14px;font-weight:600;padding:12px;border-radius:16px;border:1px dashed color-mix(in srgb,currentColor 26%,transparent);background:transparent;color:inherit;cursor:pointer;width:100%}
.pa-added{display:grid;gap:8px;padding:12px;border-radius:16px;background:color-mix(in srgb,#30a46c 14%,transparent)}
.pa-added p{margin:0;font-size:13px}
.pa-err{color:#e5484d;font-size:12px;margin:0}
.pa-phone{display:grid;gap:8px;padding:12px;border-radius:16px;border:1px solid color-mix(in srgb,currentColor 14%,transparent)}
.pa-phone p{margin:0;font-size:13px}.pa-phone small{font-size:11px;opacity:.6;word-break:break-all}
.pa-phone input{font:inherit;font-size:14px;padding:10px 12px;border-radius:12px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);background:transparent;color:inherit}
`;
function ensureStyles() {
  ensureSecureAccessStyles();
  if (document.getElementById('pa-accts-css')) return;
  const style = document.createElement('style'); style.id = 'pa-accts-css'; style.textContent = CSS; document.head.appendChild(style);
}
const initial = (label) => (String(label || '?').replace(/^@/, '').trim()[0] || '?').toUpperCase();

/**
 * @param {HTMLElement} host
 * @param {{ fetchJson: Function, connectorId: string, name: string,
 *   startConnect: () => Promise<void>, onVerify?: (message: string) => void }} opts
 * startConnect must open the plugin's normal connect flow (sign-in or credential card).
 */
export function mountConnectorAccounts(host, opts) {
  ensureStyles();
  const root = el('div', { class: 'pa-accts', 'data-connector-accounts': opts.connectorId });
  host.appendChild(root);
  let view = null;
  let seenAdded = null;
  let pollTimer = null;
  const api = (path) => `/api/connector-accounts/${encodeURIComponent(opts.connectorId)}${path}`;
  const errLine = el('p', { class: 'pa-err', role: 'alert' });

  const verifyMessage = (acct) => `I just connected a second ${opts.name} account (${acct.label}). Can you verify it works using safe, read-only checks with account "${acct.slug}"? Do not post, send, or spend.`;

  function row(acct, isDefault) {
    const actions = el('div', { class: 'pa-acct-act' });
    if (!isDefault) {
      actions.append(
        el('button', { type: 'button', class: 'pa-mini', text: 'Make default', onclick: () => act(`/${encodeURIComponent(acct.slug)}/default`, `Make ${acct.label} the default ${opts.name} account`) }),
        el('button', { type: 'button', class: 'pa-mini danger', text: 'Remove', onclick: () => { if (window.confirm(`Remove ${acct.label} from ${opts.name}?`)) act(`/${encodeURIComponent(acct.slug)}/remove`, `Remove ${acct.label} from ${opts.name} and delete its saved credential`); } }),
      );
    }
    return el('div', { class: 'pa-acct' },
      el('span', { class: 'pa-acct-dot', 'aria-hidden': 'true', text: initial(acct.label) }),
      el('span', { class: 'pa-acct-txt' }, el('b', { text: acct.label }), el('span', { text: isDefault ? 'Current account · default' : 'Pick with account: ' + acct.slug })),
      actions);
  }

  function render() {
    if (!view) return;
    root.replaceChildren(el('p', { class: 'pa-accts-title', text: 'Accounts' }));
    // Always show the current account when the plugin is connected (API-key plugins like
    // Vercel have no identity record); prefer a real email/handle over generic labels.
    const def = view.default || {};
    const generic = !def.label || /^Primary (credential|account)$/.test(def.label);
    if (def.connected || opts.connected) root.append(row({ label: generic ? (opts.accountLabel || `${opts.name} account`) : def.label, slug: 'default' }, true));
    for (const acct of view.accounts || []) root.append(row(acct, false));
    const added = view.lastAdded;
    if (added && seenAdded !== null && seenAdded !== `${added.slug}:${added.at}`) {
      const box = el('div', { class: 'pa-added', role: 'status' }, el('p', { text: `Account added: ${added.label}` }));
      if (opts.onVerify) box.append(el('button', { type: 'button', class: 'pa-mini', text: 'Ask Prom to verify', onclick: () => opts.onVerify(verifyMessage(added)) }));
      root.append(box);
    }
    root.append(el('button', { type: 'button', class: 'pa-add', text: view.adding ? 'Waiting for the new sign-in…' : 'Add another account', onclick: addAccount }), errLine);
  }

  async function load() {
    try {
      const res = await opts.fetchJson(api(''));
      if (res && res.success !== false) {
        view = res;
        if (seenAdded === null) seenAdded = res.lastAdded ? `${res.lastAdded.slug}:${res.lastAdded.at}` : '';
        render();
      }
    } catch { /* section stays hidden when the gateway is older */ }
    return view;
  }

  async function act(path, detail) {
    errLine.textContent = '';
    try { const res = await postJson(opts.fetchJson, api(path), {}, detail); if (res?.success === false) throw new Error(res.error); await load(); }
    catch (error) { errLine.textContent = `Could not update accounts: ${error?.message || error}`; }
  }

  async function addAccount() {
    errLine.textContent = '';
    try {
      const res = await postJson(opts.fetchJson, api('/add'), {});
      if (res?.success === false) throw new Error(res.error);
      view = res; render();
      await opts.startConnect();
      // Poll for the new account for a few minutes (OAuth can finish in another window or on the PC).
      clearInterval(pollTimer);
      const until = Date.now() + 5 * 60_000;
      pollTimer = setInterval(async () => {
        if (!root.isConnected || Date.now() > until) { clearInterval(pollTimer); return; }
        const next = await load();
        if (next && !next.adding) clearInterval(pollTimer);
      }, 3000);
    } catch (error) { errLine.textContent = `Could not start adding an account: ${error?.message || error}`; }
  }

  // Phone sign-in setup (OAuth plugins): the client secret goes straight to the gateway vault, never to the model.
  const phoneBox = el('div', { class: 'pa-phone', hidden: true });
  host.appendChild(phoneBox);
  async function loadPhone() {
    let item = null; let origin = '';
    try {
      const res = await opts.fetchJson('/api/protected-plugins/phone-signin');
      origin = res?.publicOrigin || '';
      item = (res?.plugins || []).find((p) => p.id === opts.connectorId) || null;
    } catch { /* older gateway or not an owner surface */ }
    if (!item || !origin || opts.connectorId === 'x') { phoneBox.hidden = true; return; }
    phoneBox.hidden = false;
    const status = item.broken ? 'Saved setup can\'t be read. Save it again.' : item.enabled ? 'On: sign-in works from your phone.' : 'Off: sign-in only finishes on the computer.';
    const idIn = el('input', { type: 'text', placeholder: 'Web client ID', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const secretIn = el('input', { type: 'password', placeholder: 'Web client secret', autocomplete: 'off' });
    const msg = el('p', { class: 'pa-err', role: 'alert' });
    const save = el('button', { type: 'button', class: 'pa-mini', text: 'Save phone sign-in', onclick: async () => {
      msg.textContent = '';
      const clientId = idIn.value.trim(); const clientSecret = secretIn.value.trim();
      if (!clientId || !clientSecret) { msg.textContent = 'Enter both the client ID and secret.'; return; }
      try {
        const res = await postJson(opts.fetchJson, `/api/protected-plugins/phone-signin/${encodeURIComponent(opts.connectorId)}`, { enabled: true, clientId, clientSecret }, `Save the ${opts.name} phone sign-in client`);
        secretIn.value = '';
        if (res?.success === false || res?.error) throw new Error(res.error);
        await loadPhone();
      } catch (error) { msg.textContent = `Could not save: ${error?.message || error}`; }
    } });
    phoneBox.replaceChildren(
      el('p', { class: 'pa-accts-title', text: 'Phone sign-in' }),
      el('p', { text: status }),
      el('small', { text: `Allowed redirect URI: ${item.redirectUri}` }),
      idIn, secretIn, save, msg);
  }

  load();
  loadPhone();
  return { refresh: load, destroy() { clearInterval(pollTimer); root.remove(); phoneBox.remove(); } };
}
