/**
 * Prometheus chat cards: single entry used by utils.renderMd and every
 * rich-artifact dispatcher (desktop ChatPage, mobile, mobile-v2).
 */
import { INTERACTIVE_FENCES, renderInteractiveCard } from './cards-interactive.js';
import { DATA_CARD_TYPES, renderDataCard } from './cards-data.js';
import { readCardState, installPromCards } from './card-runtime.js';

export { INTERACTIVE_FENCES, DATA_CARD_TYPES, renderDataCard, installPromCards };

const CARD_FENCE_RE = new RegExp('```(' + INTERACTIVE_FENCES.join('|') + ')[ \\t]*\\n([\\s\\S]*?)```', 'g');
const CARD_OPEN_RE = new RegExp('```(' + INTERACTIVE_FENCES.join('|') + ')[ \\t]*\\n[\\s\\S]*$');
const CARD_FENCE_TEST_RE = new RegExp('```(' + INTERACTIVE_FENCES.join('|') + ')[ \\t]*\\n');

function hashId(kind, body, ordinal) {
  const input = `${kind}\0${ordinal}\0${body}`;
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${kind}_${(h >>> 0).toString(36)}`;
}

/**
 * Replace complete card fences with placeholders and strip a trailing open
 * (still-streaming) card fence so raw JSON never flashes in the chat.
 * Returns { text, cards } where cards[i] is final HTML for placeholder i.
 */
export function extractCardFences(text, placeholder) {
  const cards = [];
  let ordinal = 0;
  let out = String(text || '').replace(CARD_FENCE_RE, (_, kind, body) => {
    const k = kind.toLowerCase();
    const id = hashId(k, body.trim(), ordinal++);
    let state = {};
    try { state = typeof localStorage !== 'undefined' ? readCardState(id) : {}; } catch {}
    cards.push(renderInteractiveCard(k, id, body, state));
    return `\n\n${placeholder}${cards.length - 1}END\n\n`;
  });
  const open = out.match(CARD_OPEN_RE);
  if (open) out = out.slice(0, open.index) + `\n\n<div class="pcx pc-pending"><span class="pc-muted">Building ${open[1]}…</span></div>\n\n`;
  return { text: out, cards };
}

/**
 * Inline card placement: a reply line `{{card:REF}}` puts the show_ui_card
 * artifact with that ref right there (like an inline image) instead of after
 * the reply. Unplaced artifacts keep rendering after the reply as before.
 */
export const INLINE_CARD_RE = /\{\{\s*card\s*:\s*([A-Za-z0-9_-]{2,48})\s*\}\}/g;

function messageText(m) {
  if (!m || typeof m !== 'object') return '';
  for (const v of [m.content, m.text, m.body?.text, m.message]) if (typeof v === 'string' && v) return v;
  return '';
}

export function inlineCardRefs(text) {
  const refs = new Set();
  String(text || '').replace(INLINE_CARD_RE, (_, ref) => { refs.add(ref); return ''; });
  return refs;
}

/** Artifacts of `m` that are not already placed inline in its own text. */
export function withoutInlineCards(m) {
  const list = Array.isArray(m?.richArtifacts) ? m.richArtifacts : [];
  if (!list.length) return list;
  const placed = inlineCardRefs(messageText(m));
  return placed.size ? list.filter((a) => !(a?.ref && placed.has(a.ref))) : list;
}

/** Replace inline card tokens with placeholders; returns { text, cards }. */
export function extractInlineCards(text, placeholder, artifacts, renderArtifact) {
  const cards = [];
  const list = Array.isArray(artifacts) ? artifacts : [];
  const out = String(text || '').replace(INLINE_CARD_RE, (_, ref) => {
    const art = list.find((a) => a && (a.ref === ref || a.id === ref));
    if (!art) return '';
    let html = '';
    try { html = (typeof renderArtifact === 'function' ? renderArtifact(art) : '') || renderDataCard(art) || ''; } catch {}
    if (!html) return '';
    cards.push(`<div class="pc-inline-card" data-card-ref="${ref}">${html}</div>`);
    return `\n\n${placeholder}${cards.length - 1}END\n\n`;
  });
  return { text: out, cards };
}

export function hasCardFence(text) {
  return CARD_FENCE_TEST_RE.test(String(text || ''));
}

/**
 * Inline citation chips: a markdown link whose text is a bare citation
 * ([1], [source], or the site's own hostname) renders as a small favicon pill
 * like ChatGPT's "NBA.com +1" chips. Ordinary prose links are left alone.
 */
const CITE_TEXT_RE = /^(?:\[?\d{1,2}\]?|source|src|ref|link)$/i;
export function citeChips(html) {
  if (!html || html.indexOf('<a ') === -1) return html;
  return html.replace(/<a ([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>([^<]{1,48})<\/a>/g, (whole, pre, href, post, text) => {
    const label = text.trim();
    let host = '';
    try { host = new URL(href.replace(/&amp;/g, '&')).hostname.replace(/^www\./, ''); } catch { return whole; }
    const isCite = CITE_TEXT_RE.test(label) || label.toLowerCase().replace(/^www\./, '') === host;
    if (!isCite) return whole;
    const name = host.split('.').slice(-2).join('.');
    return `<a class="pc-cite" href="${href}" target="_blank" rel="noopener noreferrer" title="${href}"><img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&amp;sz=32" alt="" loading="lazy" referrerpolicy="no-referrer">${name}</a>`;
  });
}
