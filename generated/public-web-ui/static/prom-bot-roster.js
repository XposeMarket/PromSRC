import { api } from './api.js';

const SECTION_ID = 'prom-bot-sidebar-section';
const LIST_ID = 'prom-bot-subagents-list';
const SEARCH_ID = 'prom-bot-roster-search';
const ACTIVE_ID = 'prom-bot-active-now';
const SEEN_KEY = 'prometheus_prom_bot_seen_v1';
const REFRESH_MS = 20_000;
const MAX_CONCURRENCY = 4;
const NEEDS_YOU_STATUSES = new Set(['awaiting_user_input', 'needs_assistance']);
const ACTIVE_STATUSES = new Set(['queued', 'running', 'waiting_subagent']);

let metadataByAgent = new Map();
let searchQuery = '';
let refreshTimer = 0;
let hydratePromise = null;
let observedList = null;
let listObserver = null;
let refreshQueued = false;

function readSeen() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSeen(seen) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch {}
}

function latestTimestamp(items, getter = (item) => item?.ts) {
  let latest = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const value = Number(getter(item) || 0);
    if (Number.isFinite(value) && value > latest) latest = value;
  }
  return latest;
}

function latestMessage(messages) {
  let latest = null;
  for (const message of Array.isArray(messages) ? messages : []) {
    const ts = Number(message?.ts || message?.createdAt || message?.timestamp || 0);
    const latestTs = Number(latest?.ts || latest?.createdAt || latest?.timestamp || 0);
    if (!latest || ts >= latestTs) latest = message;
  }
  return latest;
}

function previewText(message) {
  const raw = String(message?.content || message?.text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return 'No messages yet';
  const prefix = message?.role === 'user' ? 'You: ' : '';
  const text = `${prefix}${raw}`;
  return text.length > 76 ? `${text.slice(0, 73)}…` : text;
}

function relativeTime(timestamp) {
  const ts = Number(timestamp || 0);
  if (!ts) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function runNeedsUser(run) {
  const status = String(run?.status || '').toLowerCase();
  const pauseReason = String(run?.pauseReason || run?.pause_reason || '').toLowerCase();
  return NEEDS_YOU_STATUSES.has(status)
    || NEEDS_YOU_STATUSES.has(pauseReason)
    || pauseReason === 'awaiting_command_approval';
}

function runIsActive(run) {
  if (run?.inProgress === true) return true;
  return ACTIVE_STATUSES.has(String(run?.status || '').toLowerCase());
}

async function mapLimit(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (cursor < list.length) {
      const index = cursor++;
      results[index] = await mapper(list[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function collectAgentsFromRows() {
  return Array.from(document.querySelectorAll(`#${LIST_ID} .prom-bot-agent-row`)).map((row) => ({
    id: String(row.dataset.agentId || '').trim(),
    name: String(row.querySelector('.prom-bot-agent-name')?.textContent || '').trim(),
    model: String(row.querySelector('.prom-bot-agent-meta')?.textContent || '').trim(),
  })).filter((agent) => agent.id);
}

async function hydrateAgent(agent) {
  const id = agent.id;
  const [chatData, runsData] = await Promise.all([
    api(`/api/agents/${encodeURIComponent(id)}/chat?limit=20`).catch(() => ({ messages: [] })),
    api(`/api/agents/${encodeURIComponent(id)}/runs?limit=12`).catch(() => ({ runs: [] })),
  ]);
  const messages = Array.isArray(chatData?.messages) ? chatData.messages : [];
  const runs = Array.isArray(runsData?.runs) ? runsData.runs : [];
  const latest = latestMessage(messages);
  const latestTs = Number(latest?.ts || latest?.createdAt || latest?.timestamp || 0);
  const latestAgentTs = latestTimestamp(messages.filter((message) => message?.role !== 'user'), (message) => message?.ts || message?.createdAt || message?.timestamp);
  const needsYou = runs.some(runNeedsUser);
  const active = runs.some(runIsActive);
  const seen = readSeen();
  const activeOpen = String(window.promBotActiveAgentId || '') === id;
  if (activeOpen && latestAgentTs > Number(seen[id] || 0)) {
    seen[id] = latestAgentTs;
    writeSeen(seen);
  }
  return {
    ...agent,
    preview: previewText(latest),
    latestTs,
    latestAgentTs,
    needsYou,
    active,
    unread: !activeOpen && latestAgentTs > Number(seen[id] || 0),
  };
}

function installStyles() {
  if (document.getElementById('prom-bot-roster-styles')) return;
  const style = document.createElement('style');
  style.id = 'prom-bot-roster-styles';
  style.textContent = `
    .prom-bot-roster-toolbar { display:flex; flex-direction:column; gap:7px; padding:0 4px 8px; }
    .prom-bot-roster-search { width:100%; box-sizing:border-box; border:1px solid var(--sidebar-icon-border,var(--line)); background:var(--sidebar-search-bg,var(--panel-2)); color:var(--sidebar-text,var(--text)); border-radius:9px; padding:7px 9px; font:inherit; font-size:11px; outline:none; }
    .prom-bot-roster-search:focus { border-color:color-mix(in srgb,var(--pm-gold,var(--brand)) 55%,transparent); box-shadow:0 0 0 2px color-mix(in srgb,var(--pm-gold,var(--brand)) 12%,transparent); }
    .prom-bot-active-now { display:none; flex-direction:column; gap:5px; }
    .prom-bot-active-now.visible { display:flex; }
    .prom-bot-active-title { font-size:9px; text-transform:uppercase; letter-spacing:.12em; font-weight:800; color:var(--sidebar-muted,var(--muted)); }
    .prom-bot-active-pills { display:flex; gap:6px; overflow-x:auto; scrollbar-width:none; padding-bottom:1px; }
    .prom-bot-active-pills::-webkit-scrollbar { display:none; }
    .prom-bot-active-pill { border:1px solid color-mix(in srgb,#36c986 35%,var(--line)); background:color-mix(in srgb,#36c986 9%,transparent); color:var(--sidebar-text,var(--text)); border-radius:999px; padding:4px 7px; font:inherit; font-size:9px; font-weight:750; white-space:nowrap; cursor:pointer; }
    .prom-bot-agent-row.prom-bot-unread .prom-bot-agent-name { font-weight:900; }
    .prom-bot-agent-preview { display:block; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; color:var(--sidebar-muted,var(--muted)); opacity:.9; }
    .prom-bot-agent-badges { display:flex; flex-direction:column; align-items:flex-end; justify-content:center; gap:3px; min-width:44px; }
    .prom-bot-agent-time { font-size:9px; color:var(--sidebar-muted,var(--muted)); white-space:nowrap; }
    .prom-bot-agent-signals { display:flex; align-items:center; justify-content:flex-end; gap:4px; min-height:13px; }
    .prom-bot-needs-you { padding:2px 5px; border-radius:999px; background:color-mix(in srgb,#e8b84a 14%,transparent); border:1px solid color-mix(in srgb,#e8b84a 42%,transparent); color:var(--pm-gold,#e8b84a); font-size:8px; font-weight:850; white-space:nowrap; }
    .prom-bot-unread-dot { width:6px; height:6px; border-radius:50%; background:var(--pm-gold,var(--brand)); box-shadow:0 0 0 3px color-mix(in srgb,var(--pm-gold,var(--brand)) 12%,transparent); }
    .prom-bot-agent-state { margin-left:1px; }
    .prom-bot-roster-no-results { padding:8px 10px 12px; color:var(--sidebar-muted,var(--muted)); font-size:11px; }
  `;
  document.head.appendChild(style);
}

function ensureToolbar() {
  const section = document.getElementById(SECTION_ID);
  const list = document.getElementById(LIST_ID);
  if (!section || !list) return null;
  let toolbar = section.querySelector('.prom-bot-roster-toolbar');
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.className = 'prom-bot-roster-toolbar';
    const search = document.createElement('input');
    search.id = SEARCH_ID;
    search.className = 'prom-bot-roster-search';
    search.type = 'search';
    search.placeholder = 'Search subagents';
    search.setAttribute('aria-label', 'Search Prom Bot subagents');
    search.addEventListener('input', () => {
      searchQuery = search.value.trim().toLowerCase();
      decorateRows();
    });
    const active = document.createElement('div');
    active.id = ACTIVE_ID;
    active.className = 'prom-bot-active-now';
    toolbar.append(search, active);
    section.insertBefore(toolbar, list);
  }
  return toolbar;
}

function renderActiveNow() {
  const host = document.getElementById(ACTIVE_ID);
  if (!host) return;
  const activeAgents = Array.from(metadataByAgent.values()).filter((meta) => meta.active);
  host.replaceChildren();
  host.classList.toggle('visible', activeAgents.length > 0);
  if (!activeAgents.length) return;
  const title = document.createElement('div');
  title.className = 'prom-bot-active-title';
  title.textContent = 'Active now';
  const pills = document.createElement('div');
  pills.className = 'prom-bot-active-pills';
  for (const agent of activeAgents) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'prom-bot-active-pill';
    pill.textContent = agent.name || agent.id;
    pill.addEventListener('click', () => document.querySelector(`#${LIST_ID} .prom-bot-agent-row[data-agent-id="${CSS.escape(agent.id)}"]`)?.click());
    pills.appendChild(pill);
  }
  host.append(title, pills);
}

function ensureBadgeColumn(row) {
  let badges = row.querySelector('.prom-bot-agent-badges');
  if (badges) return badges;
  badges = document.createElement('span');
  badges.className = 'prom-bot-agent-badges';
  const state = row.querySelector('.prom-bot-agent-state');
  if (state) {
    row.insertBefore(badges, state);
    badges.appendChild(state);
  } else {
    row.appendChild(badges);
  }
  return badges;
}

function decorateRows() {
  ensureToolbar();
  const rows = Array.from(document.querySelectorAll(`#${LIST_ID} .prom-bot-agent-row`));
  let visibleCount = 0;
  for (const row of rows) {
    const id = String(row.dataset.agentId || '').trim();
    const meta = metadataByAgent.get(id);
    const name = String(row.querySelector('.prom-bot-agent-name')?.textContent || '').trim();
    const model = String(row.querySelector('.prom-bot-agent-meta')?.textContent || '').trim();
    const searchable = `${name} ${id} ${model} ${meta?.preview || ''}`.toLowerCase();
    const matches = !searchQuery || searchable.includes(searchQuery);
    row.hidden = !matches;
    if (matches) visibleCount += 1;
    if (!meta) continue;

    row.classList.toggle('prom-bot-unread', meta.unread);
    const copy = row.querySelector('.prom-bot-agent-copy');
    if (copy) {
      let preview = copy.querySelector('.prom-bot-agent-preview');
      if (!preview) {
        preview = document.createElement('span');
        preview.className = 'prom-bot-agent-preview';
        copy.appendChild(preview);
      }
      preview.textContent = meta.preview;
    }

    const badges = ensureBadgeColumn(row);
    let time = badges.querySelector('.prom-bot-agent-time');
    if (!time) {
      time = document.createElement('span');
      time.className = 'prom-bot-agent-time';
      badges.prepend(time);
    }
    time.textContent = relativeTime(meta.latestTs);

    let signals = badges.querySelector('.prom-bot-agent-signals');
    if (!signals) {
      signals = document.createElement('span');
      signals.className = 'prom-bot-agent-signals';
      badges.insertBefore(signals, badges.querySelector('.prom-bot-agent-state'));
    }
    signals.replaceChildren();
    if (meta.needsYou) {
      const needs = document.createElement('span');
      needs.className = 'prom-bot-needs-you';
      needs.textContent = 'Needs you';
      signals.appendChild(needs);
    }
    if (meta.unread) {
      const dot = document.createElement('span');
      dot.className = 'prom-bot-unread-dot';
      dot.title = 'Unread';
      signals.appendChild(dot);
    }
    const state = badges.querySelector('.prom-bot-agent-state');
    state?.classList.toggle('working', meta.active);
    if (state) state.title = meta.active ? 'Working' : 'Ready';
  }

  let noResults = document.querySelector(`#${LIST_ID} .prom-bot-roster-no-results`);
  if (rows.length && !visibleCount) {
    if (!noResults) {
      noResults = document.createElement('div');
      noResults.className = 'prom-bot-roster-no-results';
      document.getElementById(LIST_ID)?.appendChild(noResults);
    }
    noResults.textContent = 'No matching subagents.';
  } else {
    noResults?.remove();
  }
  renderActiveNow();
}

async function hydrateRoster({ force = false } = {}) {
  if (!window.promBotMode || document.hidden) return [];
  if (hydratePromise && !force) return hydratePromise;
  const agents = collectAgentsFromRows();
  if (!agents.length) return [];
  hydratePromise = (async () => {
    const hydrated = await mapLimit(agents, MAX_CONCURRENCY, hydrateAgent);
    metadataByAgent = new Map(hydrated.map((agent) => [agent.id, agent]));
    decorateRows();
    return hydrated;
  })().finally(() => { hydratePromise = null; });
  return hydratePromise;
}

function queueHydrate() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => {
    refreshQueued = false;
    ensureToolbar();
    decorateRows();
    void hydrateRoster();
  });
}

function bindListObserver() {
  const list = document.getElementById(LIST_ID);
  if (!list || list === observedList) return;
  listObserver?.disconnect();
  observedList = list;
  listObserver = new MutationObserver(queueHydrate);
  listObserver.observe(list, { childList: true, subtree: false });
  list.addEventListener('click', (event) => {
    const row = event.target instanceof Element ? event.target.closest('.prom-bot-agent-row') : null;
    const id = String(row?.dataset?.agentId || '').trim();
    const meta = metadataByAgent.get(id);
    if (!id || !meta) return;
    const seen = readSeen();
    seen[id] = Math.max(Number(seen[id] || 0), Number(meta.latestAgentTs || 0), Date.now());
    writeSeen(seen);
    meta.unread = false;
    decorateRows();
  }, true);
}

function startRefreshTimer() {
  clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => {
    if (window.promBotMode && !document.hidden) void hydrateRoster({ force: true });
  }, REFRESH_MS);
}

function initRosterIntelligence() {
  installStyles();
  const observer = new MutationObserver(() => {
    ensureToolbar();
    bindListObserver();
    if (window.promBotMode) queueHydrate();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  ensureToolbar();
  bindListObserver();
  startRefreshTimer();
  if (window.promBotMode) queueHydrate();
  window.addEventListener('focus', () => window.promBotMode && void hydrateRoster({ force: true }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window.promBotMode) void hydrateRoster({ force: true });
  });
}

window.refreshPromBotRosterIntelligence = hydrateRoster;
window.getPromBotRosterMetadata = () => Array.from(metadataByAgent.values()).map((entry) => ({ ...entry }));

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initRosterIntelligence, { once: true });
else initRosterIntelligence();
