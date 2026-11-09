// Shared protected-access UI (desktop, web and mobile PWA).
//
// Security rules for this module (see .pr/UI-CONTRACT.md):
// - Secret values live ONLY in native <input> elements inside the card DOM.
//   They are read once at submit time, sent to the dedicated submit endpoint
//   and cleared. Never stored in JS state, storage, chat/question data,
//   notifications or console output. Nothing here writes storage at all.
// - Cards clear secrets on success, cancel, expiry, hide, pagehide and unmount.
// - Only metadata (labels, origins, identifiers, states) is rendered/polled.

export const SECURE_ACCESS_API = '/api/secure-access';
const STYLE_ID = 'prom-secure-access-styles';

const CSS = `
.sa-card{--sa-b:var(--prom-border,color-mix(in srgb,currentColor 18%,transparent));--sa-m:var(--prom-muted,color-mix(in srgb,currentColor 62%,transparent));--sa-a:var(--prom-accent,var(--accent,#5b7cfa));border:1px solid var(--sa-b);border-radius:14px;background:var(--prom-surface,transparent);color:var(--prom-text,inherit);padding:14px;display:grid;gap:12px;max-width:460px;box-sizing:border-box;font-family:var(--font-sans,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif);font-size:14px;line-height:1.45}
.sa-card h2,.sa-card h3{margin:0;font-size:18px;line-height:1.3}.sa-card p{margin:0}.sa-card a.sa-btn{display:flex;align-items:center;justify-content:center;text-decoration:none}
.sa-card *{box-sizing:border-box}
.sa-hd{display:flex;gap:10px;align-items:flex-start}.sa-hd svg{flex:none;color:var(--sa-a);margin-top:2px}
.sa-hd h3{font-size:15px;margin:0}.sa-muted,.sa-hd p{margin:0;color:var(--sa-m);font-size:12.5px;overflow-wrap:anywhere}
.sa-form{display:grid;gap:12px;margin:0}
.sa-field{display:grid;gap:4px}.sa-lbl{font-size:12px;font-weight:600;color:var(--sa-m)}
.sa-input{font:inherit;color:inherit;width:100%;min-height:44px;padding:0 12px;border:1px solid var(--sa-b);border-radius:9px;background:transparent}
.sa-input:focus-visible,.sa-btn:focus-visible,.sa-switch:focus-visible,.sa-card summary:focus-visible{outline:2px solid var(--sa-a);outline-offset:2px}
.sa-inrow{display:flex;gap:6px}.sa-inrow .sa-input{flex:1;min-width:0}
.sa-btn{font:inherit;color:inherit;min-height:44px;border-radius:9px;border:1px solid var(--sa-b);background:transparent;cursor:pointer;padding:0 12px}
.sa-btn[disabled]{opacity:.55;cursor:not-allowed}.sa-btn.sa-sm{min-height:36px;font-size:12.5px;padding:0 10px}
.sa-btn.sa-pri{background:var(--sa-a);border-color:transparent;color:var(--prom-on-accent,#fff);font-weight:600}
.sa-btn.sa-danger{color:var(--prom-danger,#d64545);border-color:color-mix(in srgb,var(--prom-danger,#d64545) 45%,transparent)}
.sa-row{display:flex;gap:8px;flex-wrap:wrap}.sa-row>.sa-btn{flex:1 1 120px}
.sa-switch{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;font:inherit;color:inherit;min-height:44px;border:1px solid var(--sa-b);border-radius:9px;background:transparent;padding:6px 12px;cursor:pointer}
.sa-switch[disabled]{cursor:not-allowed;opacity:.75}
.sa-knob{flex:none;width:36px;height:20px;border-radius:10px;border:1px solid var(--sa-b);position:relative}
.sa-knob::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--sa-m);transition:left .15s}
.sa-switch[aria-checked="true"] .sa-knob{background:var(--sa-a);border-color:transparent}.sa-switch[aria-checked="true"] .sa-knob::after{left:18px;background:var(--prom-on-accent,#fff)}
.sa-check{display:flex;gap:8px;align-items:flex-start;font-size:12.5px}.sa-check input{margin-top:3px;width:16px;height:16px;flex:none}
.sa-card details{border:1px solid var(--sa-b);border-radius:9px;padding:0 12px}
.sa-card summary{min-height:40px;display:flex;align-items:center;cursor:pointer;font-weight:600;font-size:13px}
.sa-card details ul,.sa-sum{margin:0 0 10px;padding-left:18px;font-size:12.5px;color:var(--sa-m)}
.sa-err{color:var(--prom-danger,#d64545);font-size:12.5px;margin:0}.sa-err:empty,.sa-card>.sa-muted:empty{display:none}
.sa-ok{color:var(--prom-success,#2f9e63)}.sa-warn{color:var(--prom-warning,#b7791f)}
.sa-badge{display:inline-flex;align-items:center;border:1px solid var(--sa-b);border-radius:999px;padding:1px 8px;font-size:11px;color:var(--sa-m);white-space:nowrap}
.sa-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.sa-dock{display:grid;gap:10px;padding:8px 12px}
.sa-dock[hidden],.sa-card [hidden],.sa-card[hidden],.sa-settings [hidden]{display:none!important}
.sa-dock-desktop{justify-items:center;width:100%;box-sizing:border-box}.sa-dock-desktop .sa-card{width:100%}
.sa-dock-mobile{position:absolute;left:12px;right:12px;z-index:40;bottom:calc(var(--pm-tabbar-h,64px) + env(safe-area-inset-bottom) + 92px);max-height:50vh;max-height:min(62vh,calc(100dvh - 240px));overflow:auto;overscroll-behavior:contain;padding:0;justify-items:center;box-sizing:border-box}
.sa-dock-mobile .sa-card{width:100%;background:var(--prom-surface,var(--pm-surface,Canvas))}
.sa-settings{display:grid;gap:12px;max-width:720px}.sa-settings .sa-card{max-width:none}
.sa-cred-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.sa-panel{display:grid;gap:8px;border-top:1px solid var(--sa-b);padding-top:10px}
`;

export function ensureSecureAccessStyles(doc = globalThis.document) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

/** Tiny DOM builder. Data is always inserted as text, never as HTML. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(typeof child === 'object' ? child : String(child));
  }
  return node;
}

export function lockIcon(size = 20) {
  const wrap = document.createElement('span');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = `<svg width="${Number(size) || 20}" height="${Number(size) || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.4"/></svg>`;
  return wrap.firstChild;
}

// F3: protected writes need the desktop app owner session or a paired phone.
// Agent-driven/plain browsers fail closed; say so instead of a generic retry hint.
export const OWNER_SURFACE_MESSAGE = 'For your security, approve this in the Prometheus desktop app or on a phone paired with it. This browser cannot approve protected access.';
export const OWNER_CONSENT_MESSAGE = 'Not approved. Prometheus asks you to type a code in its own approval window for this; nothing was changed.';
export function secureAccessErrorText(error, fallback) {
  const text = String(error?.message || error || '');
  if (/OWNER_SURFACE_REQUIRED/.test(text)) return OWNER_SURFACE_MESSAGE;
  if (/OWNER_CONSENT_(REQUIRED|DECLINED|UNAVAILABLE)/.test(text)) return OWNER_CONSENT_MESSAGE;
  return fallback;
}

// PR821 I1: actions that need a human-typed code in the native owner-approval window
// when sent from the desktop app. Paired phones prove ownership with their device token.
const CONSENT_ROUTE = /^\/api\/secure-access\/(requests\/[^/]+\/submit|credentials\/[^/]+\/(grants|replace|delete|login\/submit))$/;
export function needsOwnerConsent(path) { const route = String(path || '').split('?')[0]; return /^\/api\/connection-attempts\/[^/]+\/connect$/.test(route) || CONSENT_ROUTE.test(route) || /^\/api\/(connection-secure-input\/[^/]+|connections\/credentials|connections\/disconnect|auth\/x-api\/credentials|auth\/x-api\/disconnect|protected-plugins\/(?:x|connection\/[^/]+)\/delete|protected-plugins\/(?:x|connection\/[^/]+)\/disconnect|connections-v2\/[^/]+\/disconnect)$/.test(route); }
export function ownerConsentBridge() {
  try { return globalThis.prometheusOwnerConsent && typeof globalThis.prometheusOwnerConsent.request === 'function' ? globalThis.prometheusOwnerConsent : null; } catch { return null; }
}
export async function postJson(fetchJson, path, body = {}, detail = '') {
  const json = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json' };
  const bridge = needsOwnerConsent(path) ? ownerConsentBridge() : null;
  if (bridge) {
    // The header binds this exact body string; send the same string unchanged.
    let res;
    try { res = await bridge.request({ method: 'POST', path: String(path).split('?')[0], body: json, detail }); }
    catch { throw new Error('OWNER_CONSENT_UNAVAILABLE'); }
    if (!res || res.approved !== true || !res.header) throw new Error('OWNER_CONSENT_DECLINED');
    headers['X-Prom-Owner-Consent'] = res.header;
  }
  return fetchJson(path, { method: 'POST', headers, body: json });
}

/** Fail-closed banner for surfaces that cannot approve (plain browser, CLI-served web, Docker). */
export function ownerSurfaceBanner(status) {
  const owner = status && status.owner;
  if (!owner || owner.canApprove) return null;
  return el('div', { class: 'sa-card', role: 'note', 'data-sa-owner-blocked': 'true' },
    el('div', { class: 'sa-hd' }, lockIcon(18), el('div', { style: 'display:grid;gap:2px' },
      el('h3', { text: 'Approvals are off on this screen' }),
      el('p', { text: owner.message || OWNER_SURFACE_MESSAGE }),
      el('p', { class: 'sa-muted', text: 'Open the Prometheus desktop app, or a phone paired from it with owner approvals allowed. Revoke still works here.' }))));
}

export function storageLabel(storage) {
  return storage === 'persistent'
    ? 'Remembered (encrypted) until you revoke or delete it'
    : 'This session only (memory, cleared when Prometheus restarts)';
}

export function isExactHttpsOriginUrl(url, origin) {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.protocol === 'https:' && parsed.origin === String(origin || '');
  } catch { return false; }
}

const PASSWORD_SETS = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+?'];

function randomIndex(n, cryptoImpl) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  for (;;) {
    cryptoImpl.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** Unbiased browser-crypto password with at least one char from every class. */
export function generateSecurePassword(length = 24, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl || typeof cryptoImpl.getRandomValues !== 'function') throw new Error('Secure random generator unavailable');
  const size = Math.max(16, Math.min(64, Math.floor(Number(length) || 24)));
  const all = PASSWORD_SETS.join('');
  const out = PASSWORD_SETS.map((set) => set[randomIndex(set.length, cryptoImpl)]);
  while (out.length < size) out.push(all[randomIndex(all.length, cryptoImpl)]);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1, cryptoImpl);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

function isRendered(node) {
  if (!node || !node.isConnected) return false;
  if (typeof node.getClientRects !== 'function') return true;
  return node.getClientRects().length > 0;
}

function formatRemaining(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const MODE_COPY = {
  new: { title: 'Create a protected password', secret: 'New password', auto: 'new-password', idAuto: 'username' },
  existing: { title: 'Protected sign-in', secret: 'Password', auto: 'current-password', idAuto: 'username' },
  api_key: { title: 'Protected API key', secret: 'API key', auto: 'off', idAuto: 'off' },
  otp: { title: 'One-time code', secret: 'Code', auto: 'one-time-code', idAuto: 'off' },
};

/**
 * Mount one protected-input card for a pending request.
 * opts: { request, status, fetchJson, onResolved(meta), compact }
 * onResolved receives metadata only: {requestId, status, credentialId?, label, origin}.
 * Returns { el, destroy(), expire() }.
 */
export function mountSecureAccessCard(host, opts = {}) {
  ensureSecureAccessStyles();
  const request = opts.request || {};
  const status = opts.status || {};
  const fetchJson = opts.fetchJson;
  const mode = MODE_COPY[request.mode] ? request.mode : 'existing';
  const copy = MODE_COPY[mode];
  const persistentAllowed = status.persistentAllowed === true;
  // Entry capability is distinct from approval; replacement still needs owner proof.
  const canEnter = request.replaces ? status.owner?.canApprove : (status.entry?.canEnter ?? status.owner?.canApprove);
  const ownerBlocked = canEnter !== true;
  const uid = `sa-${String(request.id || Math.random()).replace(/[^a-zA-Z0-9_-]/g, '')}`;
  let remember = persistentAllowed;
  let busy = false;
  let destroyed = false;
  let resolved = false;
  let timer = null;

  const live = el('div', { class: 'sa-sr', 'aria-live': 'polite' });
  const say = (text) => { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); };
  const errorLine = el('p', { class: 'sa-err', role: 'alert' });
  const expiryText = el('span', { class: 'sa-badge' });

  const needsIdentifier = mode === 'new' || mode === 'existing';
  const idInput = el('input', {
    class: 'sa-input', id: `${uid}-id`, name: 'username', type: 'text',
    autocomplete: copy.idAuto, autocapitalize: 'off', spellcheck: 'false',
  });
  idInput.value = String(request.identifier || '');
  const secretInput = el('input', {
    class: 'sa-input', id: `${uid}-secret`, name: mode === 'otp' ? 'one-time-code' : 'password',
    type: mode === 'otp' ? 'text' : 'password', autocomplete: copy.auto,
    autocapitalize: 'off', spellcheck: 'false', required: true,
    'data-prom-secret': 'true', 'data-prom-no-draft': 'true',
    inputmode: mode === 'otp' ? 'numeric' : null,
  });
  secretInput.addEventListener('input', () => { delete secretInput.dataset.generated; syncRecovery(); });

  const revealBtn = el('button', { type: 'button', class: 'sa-btn sa-sm', 'aria-pressed': 'false', 'aria-controls': secretInput.id, text: 'Show' });
  revealBtn.addEventListener('click', () => {
    const show = secretInput.type === 'password';
    secretInput.type = show ? 'text' : 'password';
    revealBtn.textContent = show ? 'Hide' : 'Show';
    revealBtn.setAttribute('aria-pressed', show ? 'true' : 'false');
  });
  const secretRow = el('div', { class: 'sa-inrow' }, secretInput, mode === 'otp' ? null : revealBtn);

  const recoveryBox = el('input', { type: 'checkbox', id: `${uid}-recovery` });
  const recoveryRow = el('label', { class: 'sa-check', for: recoveryBox.id }, recoveryBox,
    el('span', { text: 'I saved this generated password in my own password manager. Prom cannot show it to you again.' }));
  recoveryRow.hidden = true;
  recoveryBox.addEventListener('change', syncSave);

  let genRow = null;
  if (mode === 'new') {
    const genBtn = el('button', { type: 'button', class: 'sa-btn sa-sm', text: 'Generate strong password' });
    const copyBtn = el('button', { type: 'button', class: 'sa-btn sa-sm', text: 'Copy', hidden: true });
    genBtn.addEventListener('click', () => {
      try {
        secretInput.value = generateSecurePassword(24);
        secretInput.dataset.generated = 'true';
        copyBtn.hidden = false;
        recoveryBox.checked = false;
        syncRecovery();
        say('Strong password generated in this card. Save it in your password manager.');
      } catch { errorLine.textContent = 'This browser cannot generate a secure password. Type one instead.'; }
    });
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(secretInput.value); say('Copied. Paste it into your password manager.'); }
      catch { say('Copy failed. Use Show and copy it manually.'); }
    });
    genRow = el('div', { class: 'sa-row' }, genBtn, copyBtn);
  }

  const knob = el('span', { class: 'sa-knob', 'aria-hidden': 'true' });
  const remTitle = el('strong', {});
  const remDesc = el('span', { class: 'sa-muted' });
  const remSwitch = el('button', { type: 'button', role: 'switch', class: 'sa-switch', disabled: !persistentAllowed },
    el('span', { style: 'display:grid;gap:2px' }, remTitle, remDesc), knob);
  remSwitch.addEventListener('click', () => { if (!persistentAllowed) return; remember = !remember; syncRemember(); say(remember ? 'Remember access on' : 'This session only'); });
  function syncRemember() {
    remSwitch.setAttribute('aria-checked', remember ? 'true' : 'false');
    remTitle.textContent = remember ? 'Remember access' : 'This session only';
    remDesc.textContent = persistentAllowed
      ? (remember ? 'Encrypted on this computer until you revoke or delete it.' : 'Kept in memory only; cleared when Prometheus restarts.')
      : 'Remembering is off: this computer has no protected key store, so access is kept in memory only and cleared when Prometheus restarts.';
  }

  const saveBtn = el('button', { type: 'submit', class: 'sa-btn sa-pri', text: 'Save protected access' });
  const cancelBtn = el('button', { type: 'button', class: 'sa-btn', text: 'Cancel' });
  function syncRecovery() {
    recoveryRow.hidden = secretInput.dataset.generated !== 'true';
    syncSave();
  }
  function syncSave() {
    const needRecovery = secretInput.dataset.generated === 'true' && !recoveryBox.checked;
    saveBtn.disabled = busy || needRecovery || ownerBlocked;
  }

  const scope = el('details', {},
    el('summary', { text: 'What Prom can and cannot do' }),
    el('ul', {},
      el('li', { text: 'Prom never sees this value. It is sent straight to the local protected vault.' }),
      el('li', { text: `Use is limited to main Prom on exactly ${request.origin || 'this site'}.` }),
      el('li', { text: 'Saving allows Prom to prepare sign-in on this site. Submitting the sign-in still needs approval; posting, sending and buying need separate approval too.' }),
      el('li', { text: 'Anyone already running programs as you on this computer is not blocked by this vault.' })));

  const form = el('form', { class: 'sa-form', autocomplete: 'on', novalidate: true, 'data-prom-no-draft': 'true' },
    needsIdentifier ? el('label', { class: 'sa-field', for: idInput.id }, el('span', { class: 'sa-lbl', text: mode === 'new' ? 'Email or username for the new account' : 'Email or username' }), idInput) : null,
    el('div', { class: 'sa-field' }, el('label', { class: 'sa-lbl', for: secretInput.id, text: copy.secret }), secretRow),
    genRow, recoveryRow, remSwitch, scope, errorLine,
    el('div', { class: 'sa-row' }, saveBtn, cancelBtn));

  if (ownerBlocked) { secretInput.disabled = true; idInput.disabled = true; }
  // Do not show a dead password field that looks like a broken touch target.
  // Keep cancellation available; owner proof remains enforced by the server.
  const body = el('div', { style: 'display:grid;gap:12px' },
    ownerBlocked ? ownerSurfaceBanner(status) : null,
    ownerBlocked ? el('div', { class: 'sa-row' }, cancelBtn) : form);
  const card = el('section', { class: 'sa-card', 'aria-labelledby': `${uid}-h`, 'data-secure-access-request': request.id || '' },
    el('div', { class: 'sa-hd' }, lockIcon(20), el('div', { style: 'display:grid;gap:2px;min-width:0;flex:1' },
      el('h3', { id: `${uid}-h`, text: `${copy.title}: ${request.label || 'access'}` }),
      el('p', { text: request.origin || '' }),
      request.purpose ? el('p', { text: request.purpose }) : null), expiryText),
    body, live);

  function wipe() {
    secretInput.value = '';
    secretInput.type = mode === 'otp' ? 'text' : 'password';
    delete secretInput.dataset.generated;
    recoveryBox.checked = false;
  }
  function finish(state, extra = {}) {
    if (resolved) return;
    resolved = true;
    wipe();
    clearInterval(timer);
    const receipt = state === 'saved'
      ? ['Saved. Prom received a reference only, never the value.', `Site: ${request.origin || ''}`, `Storage: ${storageLabel(extra.storage || (remember ? 'persistent' : 'session'))}`, 'Scope: main Prom, sign-in only']
      : [state === 'expired' ? 'This request expired. Nothing was saved.' : 'Cancelled. Nothing was saved.'];
    body.replaceChildren(el('ul', { class: 'sa-sum' }, receipt.map((t) => el('li', { text: t }))));
    expiryText.textContent = state === 'saved' ? 'Saved' : state === 'expired' ? 'Expired' : 'Cancelled';
    say(receipt[0]);
    try {
      opts.onResolved?.({ requestId: request.id, status: state, credentialId: extra.credentialId || null, label: request.label || '', origin: request.origin || '', local: !extra.elsewhere });
    } catch { /* never surface callback errors with form data */ }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || resolved) return;
    errorLine.textContent = '';
    const generated = secretInput.dataset.generated === 'true';
    if (!secretInput.value) { errorLine.textContent = `Enter the ${copy.secret.toLowerCase()}.`; secretInput.focus(); return; }
    if (needsIdentifier && !idInput.value.trim()) { errorLine.textContent = 'Enter the email or username.'; idInput.focus(); return; }
    if (generated && !recoveryBox.checked) { errorLine.textContent = 'Confirm you saved the generated password first.'; return; }
    busy = true; syncSave(); saveBtn.textContent = 'Saving…';
    try {
      const res = await postJson(fetchJson, `${SECURE_ACCESS_API}/requests/${encodeURIComponent(request.id)}/submit`, {
        identifier: needsIdentifier ? idInput.value.trim() : '',
        secret: secretInput.value,
        remember: persistentAllowed && remember,
        recoveryConfirmed: generated ? recoveryBox.checked : false,
        generated,
      });
      const cred = res?.credential || {};
      finish('saved', { credentialId: cred.id, storage: cred.storage });
    } catch (error) {
      errorLine.textContent = secureAccessErrorText(error, 'Could not save. Check the request has not expired and try again.');
    } finally {
      busy = false; saveBtn.textContent = 'Save protected access'; syncSave();
    }
  });
  cancelBtn.addEventListener('click', async () => {
    if (busy || resolved) return;
    wipe();
    busy = true; syncSave();
    try { await postJson(fetchJson, `${SECURE_ACCESS_API}/requests/${encodeURIComponent(request.id)}/cancel`, {}); } catch { /* still cleared locally */ }
    busy = false;
    finish('cancelled');
  });

  const expiresAt = Date.parse(request.expiresAt || '') || 0;
  let mounted = false;
  function tick() {
    // Unmount (route change, settings re-render): wipe and stop timers.
    if (card.isConnected) mounted = true;
    else if (mounted) { handle.destroy(); return; }
    if (destroyed || resolved) return;
    if (!expiresAt) { expiryText.textContent = 'Pending'; return; }
    const left = expiresAt - Date.now();
    if (left <= 0) { finish('expired'); return; }
    expiryText.textContent = `Expires ${formatRemaining(left)}`;
  }
  const onPageHide = () => wipe();
  globalThis.addEventListener?.('pagehide', onPageHide);
  syncRemember(); syncRecovery(); tick();
  timer = setInterval(tick, 1000);
  host.appendChild(card);

  const handle = {
    el: card,
    get resolved() { return resolved; },
    expire() { finish('expired'); },
    markResolvedElsewhere(state) { if (!resolved) finish(state === 'saved' ? 'saved' : state === 'expired' ? 'expired' : 'cancelled', { elsewhere: true }); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      wipe();
      clearInterval(timer);
      globalThis.removeEventListener?.('pagehide', onPageHide);
      card.remove();
    },
  };
  return handle;
}

/**
 * Owner sign-in approval for a protected login fill that the backend already
 * prepared (credential.pendingLogin). Login only: no other account action.
 * Shows metadata only. Returns { el, destroy() }.
 */
export function mountPendingLoginCard(host, opts = {}) {
  ensureSecureAccessStyles();
  const cred = opts.credential || {};
  const fetchJson = opts.fetchJson;
  const base = `${SECURE_ACCESS_API}/credentials/${encodeURIComponent(cred.id || '')}`;
  const origin = cred.loginOrigin || cred.origin || '';
  const err = el('p', { class: 'sa-err', role: 'alert' });
  const body = el('div', { style: 'display:grid;gap:10px' });
  let done = false;
  const card = el('section', { class: 'sa-card', 'data-secure-access-login': cred.id || '', 'aria-label': `Sign-in approval for ${cred.label || origin}` },
    el('div', { class: 'sa-hd' }, lockIcon(20), el('div', { style: 'display:grid;gap:2px;min-width:0;flex:1' },
      el('h3', { text: `Approve sign-in: ${cred.label || origin}` }),
      el('p', { text: `${origin}${cred.identifier ? ` \u00b7 ${cred.identifier}` : ''}` }))),
    body, err);
  const resolve = (status) => {
    if (done) return;
    done = true;
    try { opts.onResolved?.({ credentialId: cred.id, status, label: cred.label || '', origin }); } catch { /* metadata only */ }
  };
  const outcome = async (verified) => {
    try {
      await postJson(fetchJson, `${base}/outcome`, { verified });
      body.replaceChildren(el('p', { class: 'sa-muted', text: verified ? 'Marked as working.' : 'Marked as not working. You can replace it in Settings > Saved access.' }));
      resolve(verified ? 'login_verified' : 'login_failed');
    } catch (error) { err.textContent = secureAccessErrorText(error, 'Could not record that. Try again.'); }
  };
  body.append(
    el('p', { class: 'sa-muted', text: 'Prom filled the sign-in form in a protected page it cannot read. Approving submits that sign-in only. Posting, sending, buying or other actions still ask you separately.' }),
    el('div', { class: 'sa-row' },
      el('button', { type: 'button', class: 'sa-btn sa-pri', text: 'Approve sign-in', onclick: async (event) => {
        err.textContent = '';
        event.currentTarget.disabled = true;
        try {
          const out = await postJson(fetchJson, `${base}/login/submit`, { confirm: true });
          body.replaceChildren(
            el('p', { class: 'sa-muted', text: out?.transferred === false ? 'Sign-in was not sent. Nothing changed.' : 'Sign-in sent. The result is unknown until checked. Did it work?' }),
            el('div', { class: 'sa-row' },
              el('button', { type: 'button', class: 'sa-btn sa-sm', text: 'It worked', onclick: () => outcome(true) }),
              el('button', { type: 'button', class: 'sa-btn sa-sm', text: 'It did not work', onclick: () => outcome(false) }),
              el('button', { type: 'button', class: 'sa-btn sa-sm', text: 'Not sure yet', onclick: () => resolve('login_submitted') })));
          if (out?.transferred === false) resolve('login_not_sent');
        } catch (error) { err.textContent = secureAccessErrorText(error, 'Sign-in could not be sent. It may have expired.'); event.currentTarget.disabled = false; }
      } }),
      el('button', { type: 'button', class: 'sa-btn', text: 'Decline', onclick: async () => {
        try { await postJson(fetchJson, `${base}/login/cancel`, {}); } catch { /* best effort */ }
        body.replaceChildren(el('p', { class: 'sa-muted', text: 'Declined. Nothing was submitted.' }));
        resolve('login_declined');
      } })));
  host.appendChild(card);
  return { el: card, get resolved() { return done; }, destroy() { card.remove(); } };
}

/**
 * Metadata-only continuation text for the originating chat. Never includes
 * secrets, form drafts or identifiers typed by the user.
 */
export function secureAccessContinuationText(meta = {}) {
  const label = String(meta.label || 'access').replace(/[\r\n]+/g, ' ').slice(0, 80);
  const origin = String(meta.origin || '').replace(/[\r\n]+/g, ' ').slice(0, 200);
  if (meta.status === 'saved') return `[Secure access saved] ${label} for ${origin} is ready (access id ${String(meta.credentialId || '').slice(0, 80)}). Please continue.`;
  if (meta.status === 'login_submitted' || meta.status === 'login_verified') return `[Secure sign-in approved] Sign-in to ${origin} with ${label} was ${meta.status === 'login_verified' ? 'confirmed working' : 'submitted (outcome not yet confirmed)'}. Please continue.`;
  if (meta.status === 'login_failed') return `[Secure sign-in failed] I confirmed sign-in to ${origin} with ${label} did not work.`;
  if (meta.status === 'login_declined' || meta.status === 'login_not_sent') return `[Secure sign-in declined] Sign-in to ${origin} was not submitted.`;
  if (meta.status === 'expired') return `[Secure access expired] The ${label} request for ${origin} expired without saving anything.`;
  return `[Secure access declined] I cancelled the ${label} request for ${origin}. Nothing was saved.`;
}

/**
 * Chat dock: polls pending request metadata for the active session (every
 * 2.5s, only while the dock is visible and the page is not hidden) and mounts
 * one card per pending request. Existing cards are kept as-is so typed values
 * are never re-rendered away. Returns { setSession(id), refresh(), destroy() }.
 */
/**
 * Mobile dock fit: keep the dock just above the composer's live top edge and
 * inside the visual viewport (keyboard open/pan). Event-driven + rAF throttled;
 * no resize observers (avoids layout feedback loops). Writes only bottom and
 * max-height on the dock, which never moves the composer it measures.
 */
function createMobileDockFit(host) {
  const win = globalThis.window;
  const vv = win?.visualViewport;
  let raf = 0;
  function fit() {
    raf = 0;
    if (host.hidden || !host.isConnected) return;
    const parent = host.parentElement;
    // Target the real composer, never a nested protected-entry form.
    const composer = parent?.querySelector?.('#pm-composer');
    const anchors = [composer, parent?.querySelector?.('#pm-chat-mode-launcher'), parent?.querySelector?.('#pm-new-chat-context-dock')];
    const rects = anchors.filter(Boolean).filter((node) => {
      const style = win.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
    }).map(node => node.getBoundingClientRect()).filter(rect => rect.height > 0);
    const op = host.offsetParent;
    if (!rects.length || !op) return;
    const c = rects.reduce((top, rect) => rect.top < top.top ? rect : top);
    const o = op.getBoundingClientRect();
    if (!(c.height > 0) || !(o.height > 0)) return;
    const viewTop = Math.max(Number(o.top) || 0, vv ? Number(vv.offsetTop) || 0 : 0);
    // Absolute positioning uses the scroller's padding box, whereas rects are
    // viewport coordinates. Account for scrolling and the parent's border.
    const parentBottom = o.top + op.clientTop + op.clientHeight;
    const bottom = Math.max(8, Math.round(parentBottom - c.top + 8 - op.scrollTop));
    const maxH = Math.max(0, Math.min(Math.round(c.top - viewTop - 12), Math.round((vv?.height || win.innerHeight) * 0.62)));
    host.style.bottom = `${bottom}px`;
    host.style.maxHeight = `${maxH}px`;
  }
  const schedule = () => {
    if (raf || typeof win?.requestAnimationFrame !== 'function') return;
    raf = win.requestAnimationFrame(fit);
  };
  vv?.addEventListener?.('resize', schedule);
  vv?.addEventListener?.('scroll', schedule);
  win?.addEventListener?.('resize', schedule);
  // Capture ancestor scrolling so the card stays attached to the composer.
  win?.addEventListener?.('scroll', schedule, true);
  host.addEventListener?.('focusin', schedule);
  return {
    schedule,
    destroy() {
      if (raf) win?.cancelAnimationFrame?.(raf);
      raf = 0;
      vv?.removeEventListener?.('resize', schedule);
      vv?.removeEventListener?.('scroll', schedule);
      win?.removeEventListener?.('resize', schedule);
      win?.removeEventListener?.('scroll', schedule, true);
      host.removeEventListener?.('focusin', schedule);
    },
  };
}

export function mountSecureAccessDock(host, opts = {}) {
  ensureSecureAccessStyles();
  const fetchJson = opts.fetchJson;
  const intervalMs = Math.max(2000, Math.min(3000, Number(opts.intervalMs) || 2500));
  const cards = new Map();
  const handled = new Set();
  let sessionId = String(opts.sessionId || '').trim();
  let status = null;
  let timer = null;
  let inflight = false;
  let destroyed = false;
  host.classList.add('sa-dock');
  host.hidden = true;
  const mobileFit = host.classList.contains('sa-dock-mobile') ? createMobileDockFit(host) : null;

  const logins = new Map();
  const loginHandled = new Set();
  function clearCards() {
    for (const card of cards.values()) card.destroy();
    cards.clear();
    for (const card of logins.values()) card.destroy();
    logins.clear();
    host.hidden = true;
  }
  // Pending protected sign-ins (credential.pendingLogin) shown in the chat
  // feed so the owner can approve without opening Settings. When the backend
  // exposes loginSessionId only the matching chat shows the card.
  async function refreshPendingLogins(sid) {
    const res = await fetchJson(`${SECURE_ACCESS_API}/credentials`).catch(() => null);
    if (destroyed || sid !== sessionId || !res) return;
    const pending = (Array.isArray(res.credentials) ? res.credentials : [])
      .filter((c) => c && c.pendingLogin === true && (!c.loginSessionId || c.loginSessionId === sid))
      .filter((c) => { const t = Date.parse(c.loginExpiresAt || ''); return !t || t > Date.now(); });
    const ids = new Set(pending.map((c) => c.id));
    for (const [id, card] of logins) {
      if (!ids.has(id) && !card.resolved) { card.destroy(); logins.delete(id); }
    }
    for (const cred of pending) {
      if (logins.has(cred.id) || loginHandled.has(`${cred.id}:${cred.loginPreparedAt || ''}`)) continue;
      const key = `${cred.id}:${cred.loginPreparedAt || ''}`;
      const card = mountPendingLoginCard(host, {
        credential: cred, fetchJson,
        onResolved: (meta) => {
          loginHandled.add(key);
          setTimeout(() => { logins.get(cred.id)?.destroy(); logins.delete(cred.id); host.hidden = cards.size === 0 && logins.size === 0; }, 6000);
          try { opts.onResolved?.({ ...meta, requestId: `login:${key}`, local: true, sessionId: sid }); } catch { /* metadata only */ }
        },
      });
      logins.set(cred.id, card);
    }
  }
  async function refresh() {
    if (destroyed || inflight || !sessionId) return;
    if (globalThis.document?.visibilityState === 'hidden') return;
    inflight = true;
    const sid = sessionId;
    try {
      if (!status) status = await fetchJson(`${SECURE_ACCESS_API}/status`).catch(() => null);
      const res = await fetchJson(`${SECURE_ACCESS_API}/requests?sessionId=${encodeURIComponent(sid)}`);
      if (destroyed || sid !== sessionId) return;
      const list = Array.isArray(res?.requests) ? res.requests.filter((r) => r && r.sessionId === sid) : [];
      const byId = new Map(list.map((r) => [r.id, r]));
      for (const [id, card] of cards) {
        const meta = byId.get(id);
        if (card.resolved) continue;
        if (!meta || meta.status !== 'pending') card.markResolvedElsewhere(meta?.status || 'expired');
      }
      for (const req of list) {
        if (req.status !== 'pending' || cards.has(req.id) || handled.has(req.id)) continue;
        const card = mountSecureAccessCard(host, {
          request: req,
          status: status || {},
          fetchJson,
          onResolved: (meta) => {
            handled.add(meta.requestId);
            setTimeout(() => { cards.get(meta.requestId)?.destroy(); cards.delete(meta.requestId); host.hidden = cards.size === 0; }, 6000);
            try { opts.onResolved?.({ ...meta, sessionId: sid }); } catch { /* metadata callback only */ }
          },
        });
        cards.set(req.id, card);
      }
      await refreshPendingLogins(sid);
      host.hidden = cards.size === 0 && logins.size === 0;
      mobileFit?.schedule();
    } catch {
      // Metadata poll failures are silent; never log request payloads.
    } finally {
      inflight = false;
    }
  }
  let wasConnected = false;
  function loop() {
    clearTimeout(timer);
    if (destroyed) return;
    // Route/page unmount: the host left the DOM, so wipe cards and stop polling.
    if (host.isConnected) wasConnected = true;
    else if (wasConnected) { api.destroy(); return; }
    if (typeof opts.getSessionId === 'function') {
      const live = String(opts.getSessionId() || '').trim();
      if (live && live !== sessionId) { clearCards(); sessionId = live; }
    }
    if (isRendered(host.parentElement || host) || cards.size || logins.size) refresh();
    timer = setTimeout(loop, intervalMs);
  }
  const onVisible = () => { if (globalThis.document?.visibilityState === 'visible') refresh(); };
  globalThis.document?.addEventListener?.('visibilitychange', onVisible);

  const api = {
    get sessionId() { return sessionId; },
    setSession(next) {
      const sid = String(next || '').trim();
      if (sid === sessionId) return;
      clearCards();
      sessionId = sid;
      refresh();
    },
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(timer);
      globalThis.document?.removeEventListener?.('visibilitychange', onVisible);
      mobileFit?.destroy();
      clearCards();
    },
  };
  loop();
  return api;
}

/**
 * Easy continuation for the originating chat: sends ONE metadata-only line
 * through the surface's normal queued send path. `send(text)` must be the
 * surface's existing chat send/queue function. Cancellations are sent too so
 * Prom stops waiting; expiry is reported only if no newer card resolved it.
 */
export function createSecureAccessContinuation(send) {
  const sent = new Set();
  return (meta = {}) => {
    // Only the device that resolved the card continues the chat, and expiry
    // is left to the backend/tool so Prom is not nudged by a timer.
    if (!meta.requestId || meta.local === false || meta.status === 'expired') return;
    if (sent.has(meta.requestId) || typeof send !== 'function') return;
    sent.add(meta.requestId);
    try { Promise.resolve(send(secureAccessContinuationText(meta), meta)).catch(() => {}); } catch { /* ignore */ }
  };
}
