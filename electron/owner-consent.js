'use strict';
// PR821 I1: native, capture-protected owner approval for protected-access actions.
//
// The owner cookie only proves which window sent a request. Desktop automation can
// click inside that window, so owner-only actions also need a single-use consent
// header minted here, in Electron main, after a human completes this window:
//  - setContentProtection(true): screen capture/screenshot tools see a black window;
//  - a random 6-character code is drawn on a <canvas> (no DOM/accessibility text)
//    and must be typed back; submit requires a trusted (non-scripted) event;
//  - while open, the gateway refuses every desktop_* tool (HMAC-signed lock);
//  - unavailable (fail closed) when Chromium remote debugging is enabled.
// The header binds method, path and SHA-256 of the exact body, expires in 120 s
// and is single use (gateway: src/security/secure-access-consent.ts).
const crypto = require('crypto');
const path = require('path');

const WINDOW_TITLE = 'Prometheus owner approval';
const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY3479';
const CONSENT_PATHS = [
  [/^\/api\/secure-access\/requests\/[^/]+\/submit$/, 'Save protected access entered in this card'],
  [/^\/api\/secure-access\/credentials\/[^/]+\/grants$/, 'Change who may use this saved access'],
  [/^\/api\/secure-access\/credentials\/[^/]+\/replace$/, 'Replace this saved access'],
  [/^\/api\/secure-access\/credentials\/[^/]+\/delete$/, 'Delete this saved access permanently'],
  [/^\/api\/secure-access\/credentials\/[^/]+\/login\/submit$/, 'Approve sign-in with saved access'],
  [/^\/api\/pairing\/devices\/[^/]+\/owner-approval$/, 'Let this paired phone approve protected access'],
];

function consentAction(method, routePath) {
  if (String(method).toUpperCase() !== 'POST') return '';
  const hit = CONSENT_PATHS.find(([re]) => re.test(routePath));
  return hit ? hit[1] : '';
}
function deriveKey(ownerToken) {
  return crypto.createHmac('sha256', ownerToken).update('prometheus-owner-consent-v1').digest();
}
function mintConsent(ownerToken, method, routePath, body, now = Date.now()) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodySha = crypto.createHash('sha256').update(String(body || '')).digest('hex');
  const canonical = `v1|${now}|${nonce}|${String(method).toUpperCase()}|${routePath}|${bodySha}`;
  const mac = crypto.createHmac('sha256', deriveKey(ownerToken)).update(canonical).digest('hex');
  return `v1.${now}.${nonce}.${mac}`;
}
function randomCode() {
  let out = '';
  for (const b of crypto.randomBytes(6)) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}
function esc(text) {
  return String(text || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function consentHtml(action, detail, code) {
  // The code is painted on a canvas: no text node, no accessible name.
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${WINDOW_TITLE}</title><style>
body{margin:0;font:14px system-ui,sans-serif;background:#111;color:#eee;display:grid;gap:12px;padding:20px}
h1{font-size:16px;margin:0}p{margin:0;color:#bbb}canvas{background:#222;border-radius:8px}
input{font:18px monospace;letter-spacing:4px;padding:8px;border-radius:6px;border:1px solid #555;background:#000;color:#fff;text-transform:uppercase}
.row{display:flex;gap:8px}button{padding:8px 14px;border-radius:6px;border:1px solid #555;background:#222;color:#eee}
button.pri{background:#2563eb;border-color:#2563eb}#err{color:#f87171;min-height:1em}</style></head><body>
<h1>${esc(action)}</h1>${detail ? `<p>${esc(detail)}</p>` : ''}
<p>Only you can approve this. Type the code below to confirm. Prom and its tools cannot see this window.</p>
<canvas id="c" width="260" height="64" aria-hidden="true"></canvas>
<form id="f" autocomplete="off"><input id="i" maxlength="6" autofocus aria-label="Approval code" spellcheck="false">
<p id="err" role="alert"></p><div class="row"><button class="pri" type="submit">Approve</button><button type="button" id="x">Cancel</button></div></form>
<script>(()=>{const k=${JSON.stringify(code)};const c=document.getElementById('c').getContext('2d');
c.font='bold 34px monospace';c.textBaseline='middle';
for(let n=0;n<k.length;n++){c.save();c.translate(22+n*38,32);c.rotate((Math.random()-.5)*.35);c.fillStyle='hsl('+(180+Math.random()*120)+',80%,75%)';c.fillText(k[n],0,0);c.restore();}
for(let n=0;n<5;n++){c.strokeStyle='rgba(255,255,255,.18)';c.beginPath();c.moveTo(Math.random()*260,Math.random()*64);c.lineTo(Math.random()*260,Math.random()*64);c.stroke();}
const f=document.getElementById('f'),i=document.getElementById('i'),e=document.getElementById('err');
f.addEventListener('submit',async(ev)=>{ev.preventDefault();if(!ev.isTrusted)return;const r=await window.promOwnerConsent.submit(i.value.trim().toUpperCase());
if(r&&r.retry){e.textContent='That code does not match. Try again.';i.value='';i.focus();}});
document.getElementById('x').addEventListener('click',(ev)=>{if(ev.isTrusted)window.promOwnerConsent.cancel();});})();</script></body></html>`;
}

function createOwnerConsent({ BrowserWindow, app, ipcMain, ownerToken, getGatewayUrl, getParent, log }) {
  let active = null;
  let lastLockTs = 0;
  const supported = () => !app.commandLine.hasSwitch('remote-debugging-port') && !app.commandLine.hasSwitch('remote-debugging-pipe');

  async function postLock(isActive) {
    const ts = Math.max(Date.now(), lastLockTs + 1); lastLockTs = ts;
    const mac = crypto.createHmac('sha256', deriveKey(ownerToken)).update(`lock|${isActive ? 1 : 0}|${ts}`).digest('hex');
    try {
      const res = await fetch(`${getGatewayUrl()}/api/owner-consent/lock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: isActive, ts, mac }) });
      return res.ok;
    } catch { return false; }
  }

  ipcMain.handle('owner-consent:submit', (event, typed) => {
    if (!active || event.sender !== active.window.webContents) return { ok: false };
    if (String(typed || '') === active.code) { active.finish(true); return { ok: true }; }
    active.attempts += 1;
    if (active.attempts >= 3) { active.finish(false); return { ok: false }; }
    return { ok: false, retry: true };
  });
  ipcMain.handle('owner-consent:cancel', (event) => {
    if (active && event.sender === active.window.webContents) active.finish(false);
    return { ok: true };
  });

  /** Returns a consent header value, or null when the human cancelled/failed/timed out. */
  async function request({ method, path: routePath, body, detail }) {
    const action = consentAction(method, String(routePath || ''));
    if (!action) throw new Error('This action does not use owner approval.');
    if (!supported()) throw new Error('Owner approval is unavailable while remote debugging is enabled.');
    if (active) throw new Error('Another owner approval is already open.');
    // Lock desktop automation BEFORE the window exists. If the gateway did not accept the lock, fail closed.
    if (!(await postLock(true))) throw new Error('Owner approval could not lock desktop automation.');
    const code = randomCode();
    const parent = getParent && getParent();
    const window = new BrowserWindow({
      width: 420, height: 380, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      title: WINDOW_TITLE, alwaysOnTop: true, show: false, autoHideMenuBar: true, backgroundColor: '#111111',
      parent: parent && !parent.isDestroyed() ? parent : undefined, modal: !!(parent && !parent.isDestroyed()),
      webPreferences: { preload: path.join(__dirname, 'owner-consent-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, spellcheck: false },
    });
    window.setContentProtection(true);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (e) => e.preventDefault());
    return await new Promise((resolve) => {
      let done = false;
      const finish = (approved) => {
        if (done) return; done = true;
        clearTimeout(timer); active = null;
        if (!window.isDestroyed()) window.destroy();
        postLock(false).catch(() => {});
        try { log && log(`[owner-consent] ${approved ? 'approved' : 'declined'}: ${action}\n`); } catch {}
        resolve(approved ? mintConsent(ownerToken, method, routePath, body) : null);
      };
      const timer = setTimeout(() => finish(false), 110_000);
      active = { window, code, attempts: 0, finish };
      window.on('closed', () => finish(false));
      window.once('ready-to-show', () => { if (!window.isDestroyed()) { window.show(); window.focus(); } });
      window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(consentHtml(action, String(detail || '').slice(0, 160), code))).catch(() => finish(false));
    });
  }
  return { supported, request, isOpen: () => !!active, windowTitle: WINDOW_TITLE };
}

module.exports = { createOwnerConsent, mintConsent, consentAction, WINDOW_TITLE, CONSENT_PATHS };
