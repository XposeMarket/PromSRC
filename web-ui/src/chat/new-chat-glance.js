// New-chat landing (F2): small P1 mark + greeting, one status card (what is
// running, what needs you), one quiet usage line. Shared by desktop and mobile;
// data comes from GET /api/new-chat/glance. On a quiet day the card and usage
// line drop out and only the mark + greeting remain.
import { agentLogoSrc } from './external-agent-logos.js';

const TTL_MS = 30_000;
let cache = null;
let fetchedAt = 0;
let inflight = null;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON_HAND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10M8 6v8M16 6v8M4 11v3a8 8 0 0 0 16 0V9"/></svg>';
const ICON_CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const PROVIDER_LOGO = { anthropic: 'claude-code', openai_codex: 'codex', openai: 'codex' };

export function getNewChatGlance() { return cache; }

/** Fetch (TTL-cached) the glance; fetchJson is the surface's own authenticated GET. Resolves true when data changed. */
export async function loadNewChatGlance(fetchJson, { force = false } = {}) {
  if (!force && cache && Date.now() - fetchedAt < TTL_MS) return false;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const data = await fetchJson('/api/new-chat/glance');
      if (!data || data.success === false) return false;
      const before = JSON.stringify(cache);
      cache = data;
      fetchedAt = Date.now();
      return JSON.stringify(cache) !== before;
    } catch {
      return false;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function glanceGreeting(name = '', date = new Date()) {
  const h = date.getHours();
  const part = h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : 'evening';
  return name ? `${part[0].toUpperCase()}${part.slice(1)}, ${name}` : `Good ${part}`;
}

function waitedFor(ts, now = Date.now()) {
  const mins = Math.max(1, Math.round((now - ts) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

function runningAvatar(item) {
  const logo = agentLogoSrc(PROVIDER_LOGO[item.provider] || '');
  if (logo) return `<span class="pm-glance-av"><img src="${esc(logo)}" alt="" draggable="false"></span>`;
  return `<span class="pm-glance-av pm-glance-av-letter">${esc((item.title || '?').charAt(0).toUpperCase())}</span>`;
}

function runningNames(running, count) {
  const names = running.slice(0, 2).map((r) => r.title);
  const extra = count - names.length;
  return extra > 0 ? `${names.join(', ')} and ${extra} more` : names.join(' and ');
}

export function renderNewChatGlanceHtml(glance = cache, { now = new Date() } = {}) {
  const g = glance || {};
  const running = Array.isArray(g.running) ? g.running : [];
  const runningCount = Number(g.runningCount || running.length || 0);
  const needs = g.needsYou || {};
  const needsCount = Number(needs.count || 0);
  const usage = Array.isArray(g.usage) ? g.usage : [];
  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const rows = [];
  if (runningCount > 0) {
    rows.push(`<button class="pm-glance-row" type="button" data-glance-open="tasks">
      <span class="pm-glance-lead pm-glance-pile">${running.map(runningAvatar).join('')}</span>
      <span class="pm-glance-copy"><b>${runningCount} running</b><small>${esc(runningNames(running, runningCount))}</small></span>
      <span class="pm-glance-chev">${ICON_CHEV}</span></button>`);
  }
  if (needsCount > 0) {
    const oldest = Number(needs.oldestAt || 0);
    rows.push(`<button class="pm-glance-row" type="button" data-glance-open="needs-you">
      <span class="pm-glance-lead pm-glance-hand">${ICON_HAND}</span>
      <span class="pm-glance-copy"><b>${needsCount} ${needsCount === 1 ? 'thing needs' : 'things need'} you</b><small>${oldest ? `Oldest waiting ${waitedFor(oldest, now.getTime())}` : esc(needs.firstLabel || '')}</small></span>
      <span class="pm-glance-chev">${ICON_CHEV}</span></button>`);
  }
  const usageLine = usage.length
    ? `<div class="pm-glance-usage">${usage.map((u) => `<span${Number(u.leftPercent) <= 10 ? ' class="pm-glance-low"' : ''}>${esc(u.label)} ${Number(u.leftPercent)}% left</span>`).join('')}</div>`
    : '';
  return `<div class="pm-glance" aria-label="New chat">
    <div class="pm-glance-head">
      <img class="pm-glance-mark" src="/static/assets/prometheus-one/p1-mark-ring.png" alt="" aria-hidden="true" draggable="false">
      <div><div class="pm-glance-greet">${esc(glanceGreeting(g.name || '', now))}</div><div class="pm-glance-date">${esc(dateLabel)}</div></div>
    </div>
    ${rows.length ? `<div class="pm-glance-card">${rows.join('')}</div>` : ''}
    ${usageLine}
  </div>`;
}

/** Click delegation: returns 'tasks' | 'needs-you' when a glance row was tapped, else ''. */
export function glanceTarget(event) {
  const row = event?.target?.closest?.('[data-glance-open]');
  return row ? String(row.getAttribute('data-glance-open') || '') : '';
}
