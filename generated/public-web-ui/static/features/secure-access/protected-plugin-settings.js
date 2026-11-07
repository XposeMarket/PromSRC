// Saved access > Plugin keys: metadata-only lifecycle for protected plugin credentials.
// Labels never claim "Connected" from stored refs: only X with a verified OAuth account,
// or a connection whose authState is explicitly verified.
import { el, ensureSecureAccessStyles, postJson } from './secure-access-core.js';
import { openProtectedPluginCard, protectedErrorText } from './protected-plugin-card.js';

/** Pure: status label for X credential metadata. */
export function xCredentialLabel(cred = {}) {
  if (cred.stopped) return 'Stopped · re-enter to reconnect';
  if (cred.connected === true) return 'Connected (X sign-in verified)';
  if (cred.configured) return 'App stored · not connected';
  return 'Not set up';
}
/** Pure: status label for a generic plugin connection. */
export function connectionLabel(conn = {}) {
  if (conn.stopped) return 'Stopped · re-enter to reconnect';
  if (String(conn.authState || '') === 'verified') return 'Verified';
  if (/fail|error|invalid/i.test(String(conn.authState || ''))) return 'Check failed · replace the key';
  if (conn.configured || conn.authenticated) return 'Stored · not verified';
  return 'Not set up';
}
/** Pure: lifecycle endpoint for an action. */
export function lifecyclePath(kind, id, action) {
  if (!['stop', 'disconnect', 'delete'].includes(action)) throw new Error('UNSUPPORTED_ACTION');
  return kind === 'x' ? `/api/protected-plugins/x/${action}` : `/api/protected-plugins/connection/${encodeURIComponent(id)}/${action}`;
}

const ACTION_DONE = { stop: 'Use stopped. Re-enter the key to reconnect.', disconnect: 'Disconnected locally. Revoking at the provider is separate.', delete: 'Deleted from Prometheus. Revoke it at the provider if it was ever exposed.' };

export function mountProtectedPluginSaved(host, opts = {}) {
  ensureSecureAccessStyles();
  const fetchJson = opts.fetchJson;
  const confirmFn = opts.confirm || (msg => Promise.resolve(globalThis.confirm ? globalThis.confirm(msg) : false));
  const msg = el('p', { class: 'sa-muted', role: 'status', 'aria-live': 'polite' });
  const list = el('div', { style: 'display:grid;gap:8px' });
  const cardHost = el('div');
  const add = el('button', { type: 'button', class: 'sa-btn sa-pri', text: 'Add secret', onclick: () => openCard() });
  host.replaceChildren(el('div', { class: 'sa-card', 'data-protected-plugin-saved': 'true' },
    el('h3', { text: 'Plugin keys' }),
    el('p', { class: 'sa-muted', text: 'Keys and app credentials pasted into protected entry. Values are never shown again.' }),
    el('div', { class: 'sa-row' }, add), cardHost, msg, list));
  let destroyed = false;
  let card = null;
  const openCard = (serviceId) => openProtectedPluginCard(fetchJson, { host: cardHost, serviceId, onSaved: () => refresh() }).then(c => { card = c; });
  const say = (text, tone = '') => { msg.textContent = text; msg.className = `sa-muted ${tone}`; };

  async function run(kind, id, action, name) {
    if (action === 'delete' && !(await confirmFn(`Delete "${name}" from Prometheus? This does not revoke it at the provider.`))) return;
    try { await postJson(fetchJson, lifecyclePath(kind, id, action), action === 'delete' ? { confirm: true } : {}, `${action} ${name}`); say(ACTION_DONE[action], 'sa-ok'); }
    catch (error) { say(protectedErrorText(error, 'That did not work. Nothing else changed.'), 'sa-err'); }
    refresh();
  }
  const row = (name, label, kind, id, serviceId, history) => {
    const btn = (text, fn, cls = '') => el('button', { type: 'button', class: `sa-btn sa-sm ${cls}`, text, onclick: fn });
    const last = Array.isArray(history) && history.length ? history[history.length - 1] : null;
    return el('div', { class: 'sa-card', 'data-plugin-key': `${kind}:${id}` },
      el('div', { class: 'sa-cred-meta' }, el('strong', { text: name }), el('span', { class: 'sa-badge', text: label })),
      last ? el('p', { class: 'sa-muted', text: `Last: ${String(last.action || '')} ${last.at ? new Date(last.at).toLocaleString() : ''}`.trim() }) : null,
      el('div', { class: 'sa-row' },
        btn(kind === 'x' ? 'Reconnect' : 'Replace', () => openCard(serviceId)),
        btn('Stop use', () => run(kind, id, 'stop', name)),
        btn('Disconnect', () => run(kind, id, 'disconnect', name)),
        btn('Delete', () => run(kind, id, 'delete', name), 'sa-danger')));
  };
  async function refresh() {
    if (destroyed) return;
    try {
      const [st, saved] = await Promise.all([fetchJson('/api/secure-access/status').catch(() => null), fetchJson('/api/protected-plugins/saved')]);
      if (destroyed) return;
      add.disabled = !st?.owner?.canApprove;
      add.title = add.disabled ? 'Available in the Prometheus desktop app or on a paired phone' : '';
      const rows = [];
      for (const cred of saved?.credentials || []) if (cred.configured || cred.connected || cred.stopped) rows.push(row(cred.name || 'X OAuth app', xCredentialLabel(cred), 'x', 'x', 'x', cred.history));
      for (const conn of saved?.connections || []) rows.push(row(String(conn.name || conn.serviceId || conn.id), connectionLabel(conn), 'connection', conn.id, conn.serviceId, conn.history));
      list.replaceChildren(...(rows.length ? rows : [el('p', { class: 'sa-muted', text: 'No plugin keys yet.' })]));
    } catch { list.replaceChildren(el('p', { class: 'sa-err', text: 'Plugin keys are unavailable right now.' })); }
  }
  refresh();
  return { refresh, destroy() { destroyed = true; card?.close(); host.replaceChildren(); } };
}
