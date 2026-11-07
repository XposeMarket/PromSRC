// Composer integration for protected plugin entry: "Add secret" button plus an
// accidental-paste guard for the real chat composer only. Kept out of ChatPage.js
// and the mobile runtime (size ratchets). The suspect value is never copied into
// state, events, errors or storage: paste is cancelled before insertion; typed or
// dropped values are scrubbed in place before any bubbling draft listener runs.
import { containsRecognizableSecret, removeRecognizableSecrets } from '../chat/secret-format-guard.js';
import { el, ensureSecureAccessStyles } from './secure-access-core.js';
import { openProtectedPluginCard } from './protected-plugin-card.js';

export const GUARD_NOTICE_TEXT = 'That looked like a key or token, so it was kept out of the chat and drafts. To save it, open protected entry and paste it there.';

/** Pure: returns scrubbed text, or null when nothing recognizable is present. */
export function scrubComposerValue(text) {
  const value = String(text ?? '');
  return containsRecognizableSecret(value) ? removeRecognizableSecrets(value) : null;
}

function showNotice(input, fetchJson, opts) {
  ensureSecureAccessStyles();
  const doc = input.ownerDocument || document;
  doc.querySelector('[data-protected-guard-notice]')?.remove();
  const notice = el('div', { class: 'sa-card', role: 'alert', 'data-protected-guard-notice': 'true', style: 'margin:6px 0;padding:8px 10px;display:grid;gap:6px' },
    el('p', { class: 'sa-muted', text: GUARD_NOTICE_TEXT }),
    el('div', { class: 'sa-row' },
      el('button', { type: 'button', class: 'sa-btn sa-sm sa-pri', text: 'Open protected entry', onclick: () => { notice.remove(); openProtectedPluginCard(fetchJson, { host: opts.cardHost }); } }),
      el('button', { type: 'button', class: 'sa-btn sa-sm', text: 'Remove', onclick: () => { notice.remove(); input.focus?.(); } })));
  const anchor = opts.noticeAnchor || input.closest?.('form') || input.parentElement;
  anchor?.parentElement ? anchor.parentElement.insertBefore(notice, anchor) : doc.body.append(notice);
  return notice;
}

/**
 * Install capture-phase guards on the actual chat composer. opts: { fetchJson, sendButton?, form?, cardHost?, noticeAnchor? }
 * No send-anyway path exists: a matched value is never left in the composer.
 */
export function installComposerSecretGuard(input, opts = {}) {
  if (!input || input.__promSecretGuard) return input?.__promSecretGuard || null;
  const win = input.ownerDocument?.defaultView || window;
  const fetchJson = opts.fetchJson;
  const block = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const scrubInPlace = () => {
    const clean = scrubComposerValue(input.value);
    if (clean === null) return false;
    input.value = clean;
    showNotice(input, fetchJson, opts);
    // Re-announce the clean value so autosize/draft listeners only ever see safe text.
    queueMicrotask(() => input.dispatchEvent(new Event('input', { bubbles: true })));
    return true;
  };
  const onPaste = (event) => {
    if (event.target !== input) return;
    const text = event.clipboardData?.getData?.('text/plain') || '';
    if (!containsRecognizableSecret(text)) return;
    block(event); // value never enters the composer
    showNotice(input, fetchJson, opts);
  };
  const onInput = (event) => { if (event.target === input && scrubInPlace()) event.stopImmediatePropagation(); };
  const onSubmitLike = (event) => {
    const isSend = event.type === 'submit' ? event.target === (opts.form || input.form)
      : event.type === 'keydown' ? event.target === input && event.key === 'Enter' && !event.shiftKey && !event.isComposing
      : opts.sendButton && opts.sendButton.contains?.(event.target);
    if (isSend && scrubInPlace()) block(event);
  };
  const onBackstop = () => showNotice(input, fetchJson, opts);
  win.addEventListener('paste', onPaste, true);
  win.addEventListener('drop', onInput, true);
  win.addEventListener('input', onInput, true);
  win.addEventListener('keydown', onSubmitLike, true);
  win.addEventListener('click', onSubmitLike, true);
  win.addEventListener('submit', onSubmitLike, true);
  win.addEventListener('prom-protected-entry-required', onBackstop);
  const handle = {
    destroy() {
      for (const [type, fn] of [['paste', onPaste], ['drop', onInput], ['input', onInput], ['keydown', onSubmitLike], ['click', onSubmitLike], ['submit', onSubmitLike]]) win.removeEventListener(type, fn, true);
      win.removeEventListener('prom-protected-entry-required', onBackstop);
      delete input.__promSecretGuard;
    },
  };
  input.__promSecretGuard = handle;
  return handle;
}

/** Small "Add secret" button placed next to the composer. */
export function createAddSecretButton(fetchJson, opts = {}) {
  ensureSecureAccessStyles();
  return el('button', { type: 'button', class: `sa-btn sa-sm ${opts.className || ''}`.trim(), 'data-add-secret': 'true', title: 'Add a plugin key in protected entry (never sent to chat)', 'aria-label': 'Add secret', text: opts.label || 'Add secret', onclick: () => openProtectedPluginCard(fetchJson, { host: opts.cardHost, serviceId: opts.serviceId }) });
}
