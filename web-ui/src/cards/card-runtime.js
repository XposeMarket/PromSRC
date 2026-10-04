/**
 * Browser runtime for Prometheus chat cards: one delegated listener set for
 * every surface (desktop, mobile, mobile-v2, side chat). Cards are plain HTML
 * from renderMd / rich-artifact renderers; this module makes them live.
 * - Interactive fenced cards re-render in place from (spec, state).
 * - State persists per card id in localStorage, so chat re-renders, reloads
 *   and history replays keep quiz/flashcard/poll progress.
 */
import { decodeCardData, sendCardFollowUp, esc } from './card-utils.js';
import { renderInteractiveCard, reduceInteractiveCard } from './cards-interactive.js';
import { CARD_CSS } from './cards-styles.js';

const STATE_PREFIX = 'prom-card-state:';
const STYLE_ID = 'prom-cards-style';
let installed = false;

export function readCardState(id) {
  try { return JSON.parse(localStorage.getItem(STATE_PREFIX + id) || '{}') || {}; } catch { return {}; }
}

function writeCardState(id, state) {
  try { localStorage.setItem(STATE_PREFIX + id, JSON.stringify(state || {})); } catch {}
}

function rerender(el, kind, spec, state) {
  const id = el.getAttribute('data-pc-id');
  const tpl = document.createElement('template');
  tpl.innerHTML = renderInteractiveCard(kind, id, JSON.stringify(spec), state).trim();
  const next = tpl.content.firstElementChild;
  if (next) el.replaceWith(next);
}

// ── currency ───────────────────────────────────────────────────────────────
function updateCurrency(card) {
  const data = decodeCardData(card); if (!data?.rates) return;
  const q = (n) => card.querySelector(`[data-pc-fx="${n}"]`);
  const amount = Number(q('amount')?.value || 0);
  const from = q('from')?.value; const to = q('to')?.value;
  const rate = (code) => (code === data.base ? 1 : Number(data.rates[code]));
  const r = rate(to) / rate(from);
  const out = q('out'); const line = q('rate');
  if (!Number.isFinite(r)) { if (out) out.textContent = '—'; return; }
  const fmt = (v, c) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c, maximumFractionDigits: v < 1 ? 4 : 2 }).format(v); } catch { return `${v.toFixed(2)} ${c}`; } };
  if (out) out.textContent = fmt(amount * r, to);
  if (line) line.textContent = `1 ${from} = ${r.toFixed(r < 1 ? 4 : 3)} ${to}`;
}

// ── clocks ─────────────────────────────────────────────────────────────────
let clockTimer = null;
function tickClocks() {
  const cells = document.querySelectorAll('.pc-clock-cell[data-tz]');
  if (!cells.length) { clearInterval(clockTimer); clockTimer = null; return; }
  const now = new Date();
  cells.forEach((cell) => {
    const tz = cell.getAttribute('data-tz');
    try {
      cell.querySelector('[data-pc-clock="time"]').textContent = now.toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit', second: '2-digit' });
      cell.querySelector('[data-pc-clock="date"]').textContent = now.toLocaleDateString([], { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
    } catch {}
  });
}

// ── lightbox ───────────────────────────────────────────────────────────────
function openLightbox(items, start) {
  let i = start;
  const box = document.createElement('div');
  box.className = 'pc-lightbox';
  const paint = () => {
    const it = items[i] || {};
    box.innerHTML = `<button type="button" class="pc-lb-close" aria-label="Close">×</button><button type="button" class="pc-lb-nav prev" aria-label="Previous">‹</button><figure><img src="${esc(it.src || it.thumb)}" alt="${esc(it.title)}" referrerpolicy="no-referrer"><figcaption>${esc(it.title)}${it.page ? ` · <a href="${esc(it.page)}" target="_blank" rel="noopener noreferrer">${esc(it.source || 'Source')} ↗</a>` : ''}<span>${i + 1} / ${items.length}</span></figcaption></figure><button type="button" class="pc-lb-nav next" aria-label="Next">›</button>`;
  };
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const step = (d) => { i = (i + d + items.length) % items.length; paint(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); };
  box.addEventListener('click', (e) => {
    if (e.target === box || e.target.closest('.pc-lb-close')) close();
    else if (e.target.closest('.pc-lb-nav.prev')) step(-1);
    else if (e.target.closest('.pc-lb-nav.next')) step(1);
  });
  document.addEventListener('keydown', onKey);
  paint();
  document.body.appendChild(box);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); return true; } catch { return false; } finally { ta.remove(); }
}

function onClick(event) {
  const btn = event.target.closest?.('[data-pc-act]');
  if (!btn) return;
  const card = btn.closest('[data-pc-id]');
  const act = btn.getAttribute('data-pc-act');
  if (act === 'send') { event.preventDefault(); sendCardFollowUp(btn.getAttribute('data-prompt')); btn.classList.add('sent'); return; }
  if (act === 'open') { const url = btn.getAttribute('data-url'); if (url) window.open(url, '_blank', 'noopener'); return; }
  if (act === 'scroll') {
    const track = btn.parentElement?.querySelector('.pc-scroller');
    if (track) track.scrollBy({ left: Number(btn.getAttribute('data-dir')) * Math.max(220, track.clientWidth * 0.85), behavior: 'smooth' });
    return;
  }
  if (act === 'tab' && card) {
    const i = btn.getAttribute('data-i');
    card.querySelectorAll('.pc-tab').forEach((t) => t.classList.toggle('on', t === btn));
    card.querySelectorAll('.pc-tabpane').forEach((p) => { p.hidden = p.getAttribute('data-i') !== i; });
    return;
  }
  if (act === 'video-play') {
    const yt = btn.getAttribute('data-yt');
    if (!/^[A-Za-z0-9_-]{11}$/.test(yt || '')) return;
    const frame = document.createElement('iframe');
    frame.className = 'pc-video-frame';
    frame.src = `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0`;
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.title = 'Video player';
    btn.replaceWith(frame);
    return;
  }
  if (act === 'lightbox' && card) { const items = decodeCardData(card) || []; if (items.length) openLightbox(items, Number(btn.getAttribute('data-i')) || 0); return; }
  if (act === 'fx-swap' && card) {
    const from = card.querySelector('[data-pc-fx="from"]'); const to = card.querySelector('[data-pc-fx="to"]');
    if (from && to) { const v = from.value; from.value = to.value; to.value = v; updateCurrency(card); }
    return;
  }
  if (!card) return;
  const kind = card.getAttribute('data-pc-kind');
  const id = card.getAttribute('data-pc-id');
  const spec = decodeCardData(card);
  if (!kind || !id || !spec) return;
  if (act === 'copy') {
    const text = String(spec.text ?? spec.body ?? spec.content ?? '');
    void copyText(spec.subject ? `Subject: ${spec.subject}\n\n${text}` : text);
  }
  const prev = readCardState(id);
  const next = reduceInteractiveCard(kind, spec, prev, act, { k: btn.getAttribute('data-k') });
  writeCardState(id, next);
  if (kind === 'poll' && act === 'poll-send') {
    const opts = (spec.options || []).map(String);
    const picked = (next.picks || []).map((k) => opts[k]).filter(Boolean);
    sendCardFollowUp(`${spec.question}: ${picked.join(', ')}`);
  }
  if (kind === 'reminder' && act === 'rem-set') {
    sendCardFollowUp(`Set a reminder: ${spec.title}${spec.when ? ` (${spec.when})` : ''}`);
  }
  rerender(card, kind, spec, next);
}

function onInput(event) {
  const field = event.target.closest?.('[data-pc-fx]');
  if (field) updateCurrency(field.closest('.pc-currency'));
}

/** Hydrate anything that needs a first paint (currency results, clocks). */
export function hydrateCards(root = document) {
  root.querySelectorAll?.('.pc-currency:not([data-pc-ready])').forEach((card) => { card.setAttribute('data-pc-ready', '1'); updateCurrency(card); });
  if (root.querySelector?.('.pc-clock-cell[data-tz]')) { tickClocks(); if (!clockTimer) clockTimer = setInterval(tickClocks, 1000); }
}

export function installPromCards() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CARD_CSS;
    document.head.appendChild(style);
  }
  document.addEventListener('click', onClick);
  // Map pin -> scroll its place card into view.
  window.addEventListener('message', (event) => {
    const data = event?.data;
    if (!data || data.type !== 'prom-places-pin') return;
    const card = [...document.querySelectorAll('.pc-places[data-pc-id]')].find((el) => el.getAttribute('data-pc-id') === String(data.id));
    const place = card?.querySelector(`.pc-place[data-i="${Number(data.i)}"]`);
    if (!place) return;
    place.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    place.classList.add('flash');
    setTimeout(() => place.classList.remove('flash'), 1200);
  });
  document.addEventListener('input', onInput);
  document.addEventListener('change', onInput);
  hydrateCards();
  if (typeof MutationObserver === 'undefined') return;
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; hydrateCards(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
}
