/**
 * Shared helpers for Prometheus chat cards (desktop + mobile + mobile-v2).
 * Pure functions only: importing this module must not touch the DOM, so the
 * renderers can be unit-tested in node.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Only http(s) and same-origin relative URLs survive; everything else becomes ''. */
export function safeUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  return '';
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function faviconFor(url) {
  const host = hostOf(url);
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : '';
}

/** Attribute-safe JSON for data-card-json. */
export function encodeCardData(data) {
  return esc(JSON.stringify(data ?? null));
}

export function decodeCardData(el) {
  try { return JSON.parse(el?.getAttribute?.('data-card-json') || 'null'); } catch { return null; }
}

/**
 * Lenient parse for model-authored fenced card bodies: strict JSON first, then
 * trailing commas / smart quotes, then null so callers can show an error card.
 */
export function parseCardBody(body) {
  const text = String(body ?? '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  try {
    const repaired = text
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(repaired);
  } catch {}
  return null;
}

export function fmtNumber(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function stars(rating) {
  const n = Number(rating);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `<span class="pc-stars" aria-label="${esc(n.toFixed(1))} out of 5">★ ${esc(n.toFixed(1))}</span>`;
}

/**
 * Send a follow-up as the user from inside a card. Desktop exposes
 * window.sendChat, mobile exposes window.__pmMobileSendMessage.
 */
export function sendCardFollowUp(prompt) {
  const text = String(prompt || '').trim();
  if (!text || typeof window === 'undefined') return false;
  try {
    if (typeof window.__pmMobileSendMessage === 'function') { window.__pmMobileSendMessage(text); return true; }
    if (typeof window.sendChat === 'function') { window.sendChat(text); return true; }
  } catch (error) {
    console.warn('[prom-cards] follow-up send failed', error);
  }
  return false;
}

/** Visible, non-crashing error card used whenever a body cannot be rendered. */
export function cardError(kind, message) {
  const reason = String(message || 'The card data was malformed.');
  const fix = `The ${kind} card you sent failed to render (${reason}). Please resend it with a valid ${kind} body.`;
  return `<div class="pc-card pc-error" role="note"><div class="pc-error-title">Couldn't render ${esc(kind)} card</div><div class="pc-muted">${esc(reason)}</div><div class="pc-actions"><button type="button" class="pc-chip" data-pc-act="send" data-prompt="${esc(fix)}">Ask Prom to fix it</button></div></div>`;
}

export const ICON = {
  arrowL: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrowR: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a2 2 0 012-2h8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.5" fill="currentColor"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  route: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l9 9-9 9-9-9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 13v-2h5l-2-2m2 2l-2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h12l-3-3M17 17H5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0112 0v5l2 2H4z M10 20a2 2 0 004 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
};
