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
  if (open) out = out.slice(0, open.index) + `\n\n<div class="pc-card pc-pending"><span class="pc-muted">Building ${open[1]}…</span></div>\n\n`;
  return { text: out, cards };
}

export function hasCardFence(text) {
  return /```(quiz|flashcards|poll|writing|followups|reminder)[ \t]*\n/.test(String(text || ''));
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
