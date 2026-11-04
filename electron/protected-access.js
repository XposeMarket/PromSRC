'use strict';
// Broker-only, ephemeral windows. Never registered with normal browser automation.
const { randomUUID } = require('crypto');
function createProtectedAccess({ BrowserWindow, session, app, transferCookies }) {
  const active = new Map();
  const supported = () => !app.commandLine.hasSwitch('remote-debugging-port') && !app.commandLine.hasSwitch('remote-debugging-pipe');
  const close = (id) => { const item = active.get(id); if (!item) return; clearTimeout(item.timer); active.delete(id); if (!item.window.isDestroyed()) item.window.destroy(); item.partition.clearStorageData().catch(() => {}); };
  async function prepare({ credentialId, origin, url, identifier, secret, sessionId }) {
    if (!supported()) throw new Error('Protected login unavailable; use takeover.');
    const target = new URL(url); if (target.origin !== origin || target.protocol !== 'https:' || target.username || target.password) throw new Error('Login origin mismatch.');
    if (active.has(credentialId)) throw new Error('Login already prepared. Cancel before retry.');
    const partition = session.fromPartition(`protected-access-${randomUUID()}`, { cache: false });
    partition.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    partition.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false; try { allowed = new URL(details.url).origin === origin; } catch {}
      callback({ cancel: !allowed });
    });
    const window = new BrowserWindow({ show: false, webPreferences: { session: partition, nodeIntegration: false, contextIsolation: true, sandbox: true, devTools: false, webSecurity: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const item = { window, partition, origin, sessionId, timer: setTimeout(() => close(credentialId), 120000) };
    active.set(credentialId, item);
    try {
      await window.loadURL(target.href);
      if (new URL(window.webContents.getURL()).origin !== origin) throw new Error('Unsupported redirect.');
      // Only a real password field in a same-origin POST form is supported. Never arbitrary selectors.
      const ok = await window.webContents.executeJavaScript(`(() => {
        const fields = [...document.querySelectorAll('input[type=password]')].filter(e => e.getClientRects().length && !e.disabled);
        if (fields.length !== 1) return false;
        const password = fields[0], form = password.form;
        if (!form || form.method.toLowerCase() !== 'post' || new URL(form.action).origin !== location.origin || (form.target && form.target !== '_self')) return false;
        const username = [...form.querySelectorAll('input')].find(e => e !== password && !e.disabled && e.getClientRects().length && (e.autocomplete === 'username' || e.type === 'email'));
        if (!username) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(username, ${JSON.stringify(String(identifier))}); setter.call(password, ${JSON.stringify(String(secret))});
        username.setAttribute('data-prom-secret',''); password.setAttribute('data-prom-secret','');
        username.dispatchEvent(new Event('input',{bubbles:true})); password.dispatchEvent(new Event('input',{bubbles:true}));
        return true;
      })()`);
      if (ok !== true) throw new Error('Unsupported login form.');
      return { phase: 'ready', origin, filled: ['identifier', 'password'] };
    } catch { close(credentialId); throw new Error('Protected login cannot fill this page; use takeover.'); }
  }
  async function submit({ credentialId }) {
    const item = active.get(credentialId); if (!item) throw new Error('Protected login expired. Prepare again.');
    try {
      if (new URL(item.window.webContents.getURL()).origin !== item.origin) throw new Error('Origin changed.');
      // The owner explicitly approves sign-in. Dispatch once; any uncertainty is retained by broker.
      await item.window.webContents.executeJavaScript(`(() => {
        const p = document.querySelector('input[type=password][data-prom-secret]');
        const f = p && p.form;
        if (!f || f.method.toLowerCase() !== 'post' || new URL(f.action).origin !== location.origin || (f.target && f.target !== '_self')) return false;
        f.requestSubmit(); return true;
      })()`).catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 1800));
      if (item.window.isDestroyed()) return { phase: 'submitted_outcome_unknown', transferred: false };
      // Cookie bytes stay runtime-only. No HTML, URL, error, screenshot, or cookie is returned.
      const cookies = await item.partition.cookies.get({ url: item.origin });
      const safe = cookies.filter(c => c.secure && c.httpOnly && c.domain.replace(/^\./, '') === new URL(item.origin).hostname);
      let transferred = false;
      if (safe.length) { await transferCookies(item.sessionId, item.origin, safe); transferred = true; }
      return { phase: 'submitted_outcome_unknown', transferred };
    } catch { return { phase: 'submitted_outcome_unknown', transferred: false }; }
    finally { close(credentialId); }
  }
  return { supported, prepare, submit, cancel: ({ credentialId }) => { close(credentialId); return { cancelled: true }; } };
}
module.exports = { createProtectedAccess };
