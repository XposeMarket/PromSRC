// Agents & imports settings page (stage 1: import UI only).
//
// One shared module for the desktop Settings page and the mobile Settings
// surface. The host passes a JSON request function (`request(path, opts)`)
// so the module works with both the desktop `api()` helper and the mobile
// `mobileGatewayFetch()` helper.
//
// Privacy rule: the page list comes from GET /api/imports/agents, which reads
// no transcript text. Chat titles and the one-line last-message preview are
// requested only after the user opens an agent row. They are kept in this
// module's in-memory view state for the open row only and are never written to
// storage, memory, or sent to a model.

const PAGE_SIZE = 50;
const POLL_MS = 900;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function plural(count, one, many = `${one}s`) {
  const n = Number(count) || 0;
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

function freshSelection() {
  // whole: group keys ticked as a whole (includes chats not loaded yet)
  // exclude: chatId -> groupKey, unticked inside a whole group
  // chats: chatId -> groupKey ('' for loose chats), ticked one by one
  return { whole: new Set(), exclude: new Map(), chats: new Map() };
}

/**
 * Mount the page into `container`.
 * @param {HTMLElement} container
 * @param {{ request: (path: string, opts?: object) => Promise<any>, surface?: 'desktop'|'mobile' }} options
 */
export function mountAgentsImports(container, options = {}) {
  if (!container) return null;
  if (container.__agentsImports) {
    container.__agentsImports.refresh();
    return container.__agentsImports;
  }
  const request = options.request;
  const st = {
    loading: true,
    error: '',
    agents: [],
    openId: '',
    tab: 'projects',
    groups: new Map(), // agentId -> { groups, looseChats, totalChats, loading, error }
    lists: new Map(), // listKey -> { items, total, hasMore, loading, error }
    expanded: new Set(), // listKey of expanded groups (Projects tab)
    selections: new Map(), // agentId -> selection
    setup: new Map(), // setup source id -> { job, busy, error }
    whole: new Map(), // agentId -> { job, busy, error } for non-browsable sources
    run: null,
    jobs: [],
    historyOpen: false,
    fileForm: { open: false, kind: 'conversation', path: '', busy: false, error: '', job: null, picked: new Set(), shown: PAGE_SIZE },
  };
  const ctl = { refresh: () => scan(), destroy: () => { delete container.__agentsImports; container.innerHTML = ''; } };
  container.__agentsImports = ctl;
  container.classList.add('aip-root', options.surface === 'mobile' ? 'aip-mobile' : 'aip-desktop');

  async function call(path, opts = {}) {
    const next = { ...opts };
    if (next.body && typeof next.body !== 'string') next.body = JSON.stringify(next.body);
    if (next.body) next.headers = { 'Content-Type': 'application/json', ...(next.headers || {}) };
    const data = await request(path, next);
    if (data && data.success === false) throw new Error(data.error || 'Request failed.');
    return data;
  }

  function selectionFor(agentId) {
    if (!st.selections.has(agentId)) st.selections.set(agentId, freshSelection());
    return st.selections.get(agentId);
  }

  function agentById(id) {
    return st.agents.find((agent) => agent.id === id) || null;
  }

  function groupInfo(agentId, key) {
    return (st.groups.get(agentId)?.groups || []).find((group) => group.key === key) || null;
  }

  async function scan() {
    st.loading = true;
    st.error = '';
    render();
    try {
      const data = await call('/api/imports/agents', { timeoutMs: 60000 });
      st.agents = Array.isArray(data?.agents) ? data.agents : [];
    } catch (error) {
      st.agents = [];
      st.error = `Could not scan this computer: ${error.message}`;
    } finally {
      st.loading = false;
    }
    if (st.openId && !agentById(st.openId)) st.openId = '';
    render();
    loadJobs();
  }

  async function loadJobs() {
    try {
      const data = await call('/api/imports/jobs');
      st.jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    } catch { st.jobs = []; }
    render();
  }

  // ---- opened-row data (titles/previews are fetched only from here) --------
  async function loadGroups(agentId) {
    const current = st.groups.get(agentId);
    if (current?.loading) return;
    st.groups.set(agentId, { groups: [], looseChats: 0, totalChats: 0, loading: true, error: '' });
    render();
    try {
      const data = await call(`/api/imports/agents/${encodeURIComponent(agentId)}/groups`, { timeoutMs: 120000 });
      st.groups.set(agentId, { groups: data.groups || [], looseChats: Number(data.looseChats || 0), totalChats: Number(data.totalChats || 0), loading: false, error: '' });
    } catch (error) {
      st.groups.set(agentId, { groups: [], looseChats: 0, totalChats: 0, loading: false, error: error.message });
    }
    render();
  }

  function listKey(agentId, group) {
    return `${agentId}|${group || '*'}`;
  }

  async function loadChats(agentId, group, more = false) {
    const key = listKey(agentId, group);
    const current = st.lists.get(key) || { items: [], total: 0, hasMore: false, loading: false, error: '' };
    if (current.loading) return;
    const offset = more ? current.items.length : 0;
    st.lists.set(key, { ...current, items: more ? current.items : [], loading: true, error: '' });
    render();
    try {
      const query = `offset=${offset}&limit=${PAGE_SIZE}&preview=1${group ? `&group=${encodeURIComponent(group)}` : ''}`;
      const data = await call(`/api/imports/agents/${encodeURIComponent(agentId)}/chats?${query}`, { timeoutMs: 120000 });
      const prior = more ? (st.lists.get(key)?.items || []) : [];
      st.lists.set(key, { items: [...prior, ...(data.chats || [])], total: Number(data.total || 0), hasMore: !!data.hasMore, loading: false, error: '' });
    } catch (error) {
      st.lists.set(key, { ...current, loading: false, error: error.message });
    }
    render();
  }

  function openAgent(agentId) {
    if (st.openId === agentId) {
      st.openId = '';
      // Drop titles/previews for rows that are closed again.
      for (const key of [...st.lists.keys()]) if (key.startsWith(`${agentId}|`)) st.lists.delete(key);
      render();
      return;
    }
    if (st.openId) for (const key of [...st.lists.keys()]) if (key.startsWith(`${st.openId}|`)) st.lists.delete(key);
    st.openId = agentId;
    st.tab = 'projects';
    const agent = agentById(agentId);
    render();
    if (agent?.browsable) loadGroups(agentId);
  }

  // ---- selection ------------------------------------------------------------
  function chatChecked(sel, chat) {
    const g = chat.groupKey || '';
    return g && sel.whole.has(g) ? !sel.exclude.has(chat.id) : sel.chats.has(chat.id);
  }

  function toggleChat(agentId, chat) {
    const sel = selectionFor(agentId);
    const g = chat.groupKey || '';
    if (g && sel.whole.has(g)) {
      if (sel.exclude.has(chat.id)) sel.exclude.delete(chat.id);
      else sel.exclude.set(chat.id, g);
      const info = groupInfo(agentId, g);
      const excludedHere = [...sel.exclude.values()].filter((v) => v === g).length;
      if (info && excludedHere >= info.chatCount) clearGroup(sel, g);
    } else if (sel.chats.has(chat.id)) {
      sel.chats.delete(chat.id);
    } else {
      sel.chats.set(chat.id, g);
      const info = groupInfo(agentId, g);
      const pickedHere = [...sel.chats.values()].filter((v) => v === g).length;
      if (g && info && pickedHere >= info.chatCount) { clearGroup(sel, g); sel.whole.add(g); }
    }
  }

  function clearGroup(sel, g) {
    sel.whole.delete(g);
    for (const [id, key] of [...sel.exclude]) if (key === g) sel.exclude.delete(id);
    for (const [id, key] of [...sel.chats]) if (key === g) sel.chats.delete(id);
  }

  function groupSelectedCount(agentId, sel, g) {
    const info = groupInfo(agentId, g);
    if (sel.whole.has(g)) return Math.max(0, (info?.chatCount || 0) - [...sel.exclude.values()].filter((v) => v === g).length);
    return [...sel.chats.values()].filter((v) => v === g).length;
  }

  function groupState(agentId, sel, g) {
    const info = groupInfo(agentId, g);
    const count = groupSelectedCount(agentId, sel, g);
    if (!count) return 'none';
    return info && count >= info.chatCount ? 'all' : 'some';
  }

  function toggleGroup(agentId, g) {
    const sel = selectionFor(agentId);
    if (groupState(agentId, sel, g) === 'all') clearGroup(sel, g);
    else { clearGroup(sel, g); sel.whole.add(g); }
  }

  /** Running total for the bar. Exact: whole groups count unlisted chats too. */
  function summarize(agentId) {
    const sel = selectionFor(agentId);
    const keys = new Set([...sel.whole, ...[...sel.chats.values()].filter(Boolean)]);
    const groups = [];
    let total = 0;
    for (const g of keys) {
      const count = groupSelectedCount(agentId, sel, g);
      if (!count) continue;
      const info = groupInfo(agentId, g);
      groups.push({ key: g, label: info?.label || g, selected: count, total: info?.chatCount || count, kind: info?.kind || 'project' });
      total += count;
    }
    const loose = [...sel.chats.values()].filter((v) => !v).length;
    total += loose;
    return { groups, loose, total };
  }

  /** Request body for POST /api/imports/agents/:id/preflight. */
  function selectionRequest(agentId) {
    const sel = selectionFor(agentId);
    return { groups: [...sel.whole], chats: [...sel.chats.keys()], exclude: [...sel.exclude.keys()] };
  }

  function selectListed(agentId, items, on) {
    const sel = selectionFor(agentId);
    for (const chat of items) {
      if (chatChecked(sel, chat) !== on) toggleChat(agentId, chat);
    }
  }

  // ---- rendering ------------------------------------------------------------
  function tile(agent) {
    // Neutral letter tile + plain-text name. No vendor logos by design.
    return `<span class="aip-tile" aria-hidden="true">${esc(agent.letter || (agent.name || '?')[0])}</span>`;
  }

  function agentStatus(agent) {
    const parts = ['Found'];
    if (agent.chatCount) parts.push(`${plural(agent.chatCount, 'chat')} found`);
    else if (agent.setupSources?.length) parts.push('MCP config only');
    const size = formatBytes(agent.bytes);
    if (size) parts.push(size);
    return parts.join(' · ');
  }

  function renderHeader() {
    return `<div class="aip-head">
      <div class="aip-head-copy">
        <h2>Agents &amp; imports</h2>
        <p>Coding agents found on this computer. Open one to choose which chats and projects to copy into Prometheus. Nothing is imported until you confirm.</p>
      </div>
      <div class="aip-head-actions">
        <button class="aip-btn aip-btn-ghost" type="button" data-act="scan" ${st.loading ? 'disabled' : ''}>${st.loading ? 'Scanning…' : 'Scan again'}</button>
        <button class="aip-btn aip-btn-ghost" type="button" data-act="file-open">Import from a file or folder</button>
      </div>
    </div>`;
  }

  function renderEmpty() {
    return `<div class="aip-card aip-empty">
      <strong>No agents found on this computer</strong>
      <p>Prometheus looks for Claude Code, Codex, OpenClaw and Hermes Agent in their usual folders. Install one and scan again, or import chats from a file or folder.</p>
      <div class="aip-empty-actions">
        <button class="aip-btn" type="button" data-act="scan">Scan again</button>
        <button class="aip-btn aip-btn-ghost" type="button" data-act="file-open">Import from a file or folder</button>
      </div>
    </div>`;
  }

  function renderRow(agent) {
    const open = st.openId === agent.id;
    // Stage 3 extension point: a live-connection toggle and connection states
    // ("Connected", "Needs attention", "Checking…") render here. Stage 1 ships
    // no toggle on purpose: a control that does nothing is worse than none.
    const connectSlot = '';
    return `<div class="aip-row-wrap${open ? ' is-open' : ''}">
      <button class="aip-row" type="button" data-act="open" data-agent="${esc(agent.id)}" aria-expanded="${open}">
        ${tile(agent)}
        <span class="aip-row-copy">
          <span class="aip-row-name">${esc(agent.name)}${agent.importOnly ? ' <span class="aip-tag">Import only</span>' : ''}</span>
          <span class="aip-row-status">${esc(agentStatus(agent))}${agent.capped ? ' · large folder, counted up to the scan limit' : ''}</span>
        </span>
        ${connectSlot}
        <span class="aip-chev" aria-hidden="true">${open ? '⌄' : '›'}</span>
      </button>
      ${open ? renderOpened(agent) : ''}
    </div>`;
  }

  function checkbox(state, attrs, label) {
    const checked = state === 'all' || state === true;
    const mixed = state === 'some';
    return `<input type="checkbox" class="aip-check" ${checked ? 'checked' : ''} ${mixed ? 'data-indeterminate="1" aria-checked="mixed"' : ''} ${attrs} aria-label="${esc(label)}">`;
  }

  function renderChatRow(agent, chat, showGroup) {
    const sel = selectionFor(agent.id);
    const groupLabel = showGroup && chat.groupLabel ? `<span class="aip-chat-group">${esc(chat.groupLabel)}</span>` : '';
    return `<label class="aip-chat">
      ${checkbox(chatChecked(sel, chat), `data-act="chat" data-agent="${esc(agent.id)}" data-chat="${esc(chat.id)}" data-group="${esc(chat.groupKey || '')}"`, chat.title || 'chat')}
      <span class="aip-chat-copy">
        <span class="aip-chat-title">${esc(chat.title || 'Untitled chat')}</span>
        <span class="aip-chat-preview">${chat.preview ? esc(chat.preview) : '<em>No message preview</em>'}</span>
      </span>
      <span class="aip-chat-meta">${groupLabel}<span>${esc(formatDate(chat.updatedAt))}</span></span>
    </label>`;
  }

  function renderChatList(agent, group, showGroup) {
    const key = listKey(agent.id, group);
    const list = st.lists.get(key);
    if (!list || (list.loading && !list.items.length)) return '<div class="aip-note">Loading chats…</div>';
    if (list.error) return `<div class="aip-note aip-error">${esc(list.error)} <button class="aip-link" type="button" data-act="reload-list" data-agent="${esc(agent.id)}" data-group="${esc(group)}">Try again</button></div>`;
    if (!list.items.length) return '<div class="aip-note">No chats here.</div>';
    const sel = selectionFor(agent.id);
    const allListed = list.items.every((chat) => chatChecked(sel, chat));
    const remaining = Math.max(0, list.total - list.items.length);
    return `<div class="aip-list-tools">
        <button class="aip-link" type="button" data-act="select-listed" data-agent="${esc(agent.id)}" data-group="${esc(group)}" data-on="${allListed ? '0' : '1'}">${allListed ? `Clear the ${list.items.length} listed` : `Select all ${list.items.length} listed`}</button>
        <span class="aip-muted">Applies only to the chats shown${remaining ? `, not the ${remaining.toLocaleString()} still to load` : ''}.</span>
      </div>
      <div class="aip-chats">${list.items.map((chat) => renderChatRow(agent, chat, showGroup)).join('')}</div>
      ${list.hasMore ? `<button class="aip-btn aip-btn-ghost aip-more" type="button" data-act="more" data-agent="${esc(agent.id)}" data-group="${esc(group)}" ${list.loading ? 'disabled' : ''}>${list.loading ? 'Loading…' : `Show ${Math.min(PAGE_SIZE, remaining)} more (${remaining.toLocaleString()} left)`}</button>` : ''}`;
  }

  function renderGroupRow(agent, group) {
    const sel = selectionFor(agent.id);
    const state = groupState(agent.id, sel, group.key);
    const count = groupSelectedCount(agent.id, sel, group.key);
    const expanded = st.expanded.has(listKey(agent.id, group.key));
    const countLabel = state === 'none'
      ? plural(group.chatCount, 'chat')
      : state === 'all' ? `all ${plural(group.chatCount, 'chat')} selected` : `${count.toLocaleString()} of ${group.chatCount.toLocaleString()} selected`;
    return `<div class="aip-group${expanded ? ' is-expanded' : ''}">
      <div class="aip-group-head">
        ${checkbox(state, `data-act="group" data-agent="${esc(agent.id)}" data-group="${esc(group.key)}"`, `Select ${group.label}`)}
        <button class="aip-group-main" type="button" data-act="expand" data-agent="${esc(agent.id)}" data-group="${esc(group.key)}" aria-expanded="${expanded}">
          <span class="aip-group-label">${esc(group.label)}${group.kind === 'folder' ? ' <span class="aip-tag aip-tag-soft">grouped by folder</span>' : ''}</span>
          <span class="aip-group-count">${esc(countLabel)}</span>
          <span class="aip-chev" aria-hidden="true">${expanded ? '⌄' : '›'}</span>
        </button>
      </div>
      ${expanded ? `<div class="aip-group-body">${renderChatList(agent, group.key, false)}</div>` : ''}
    </div>`;
  }

  function renderLooseRow(agent, count) {
    const expanded = st.expanded.has(listKey(agent.id, 'loose'));
    const picked = [...selectionFor(agent.id).chats.values()].filter((v) => !v).length;
    return `<div class="aip-group${expanded ? ' is-expanded' : ''}">
      <div class="aip-group-head">
        <span class="aip-check-spacer" aria-hidden="true"></span>
        <button class="aip-group-main" type="button" data-act="expand" data-agent="${esc(agent.id)}" data-group="loose" aria-expanded="${expanded}">
          <span class="aip-group-label">Chats without a project or folder</span>
          <span class="aip-group-count">${picked ? `${picked.toLocaleString()} of ${count.toLocaleString()} selected` : plural(count, 'chat')}</span>
          <span class="aip-chev" aria-hidden="true">${expanded ? '⌄' : '›'}</span>
        </button>
      </div>
      ${expanded ? `<div class="aip-group-body">${renderChatList(agent, 'loose', false)}</div>` : ''}
    </div>`;
  }

  function renderSetup(agent) {
    if (!agent.setupSources?.length) return '';
    return `<div class="aip-subsection">
      <div class="aip-subhead"><strong>MCP config</strong><span class="aip-muted">Server definitions only. Keys and tokens are never copied; you authorize each server again in Plugins.</span></div>
      ${agent.setupSources.map((source) => {
        const entry = st.setup.get(source.id) || {};
        const job = entry.job;
        const preview = job?.preview || {};
        let body = `<button class="aip-btn aip-btn-ghost" type="button" data-act="setup-preview" data-agent="${esc(agent.id)}" data-source="${esc(source.id)}" ${entry.busy ? 'disabled' : ''}>${entry.busy ? 'Reading…' : 'Preview MCP config'}</button>`;
        if (job && job.status === 'preview_ready') {
          const n = Number(preview.mcpServers || 0);
          body = `<span class="aip-muted">${plural(n, 'MCP server')} · ${plural(preview.secretsRedacted || 0, 'secret')} left behind · ${plural(preview.conflicts || 0, 'conflict')} skipped</span>
            <button class="aip-btn" type="button" data-act="setup-confirm" data-source="${esc(source.id)}" ${n && !entry.busy ? '' : 'disabled'}>Import ${plural(n, 'MCP server')}</button>`;
        } else if (job && ['completed', 'partial'].includes(job.status)) {
          body = `<span class="aip-ok">${plural(job.result?.mcpServerIds?.length || 0, 'MCP server')} imported, turned off until you authorize them.</span>
            <button class="aip-link" type="button" data-act="open-plugins">Open Plugins</button>`;
        }
        return `<div class="aip-setup-row"><span class="aip-setup-label">${esc(source.label)} <span class="aip-muted">· ${plural(source.setupFileCount, 'file')}</span></span><span class="aip-setup-actions">${body}</span>${entry.error ? `<div class="aip-note aip-error">${esc(entry.error)}</div>` : ''}</div>`;
      }).join('')}
    </div>`;
  }

  function renderWholeSource(agent) {
    // Sources whose chats cannot be listed one by one (for example Cursor
    // databases) keep the existing preview-then-confirm flow for the whole source.
    const entry = st.whole.get(agent.id) || {};
    const job = entry.job;
    const preview = job?.preview || {};
    const n = Number(preview.conversations || 0);
    let body = `<button class="aip-btn aip-btn-ghost" type="button" data-act="whole-preview" data-agent="${esc(agent.id)}" ${entry.busy ? 'disabled' : ''}>${entry.busy ? 'Reading…' : 'Preview chats'}</button>`;
    if (job?.status === 'preview_ready') body = `<span class="aip-muted">${plural(n, 'chat')} readable</span><button class="aip-btn" type="button" data-act="whole-confirm" data-agent="${esc(agent.id)}" ${n && !entry.busy ? '' : 'disabled'}>Import ${plural(n, 'chat')}</button>`;
    else if (job && ['completed', 'partial', 'failed'].includes(job.status)) body = `<span class="aip-muted">${esc(String(job.progress?.message || job.status))}</span>`;
    return `<div class="aip-subsection"><div class="aip-subhead"><strong>Chats</strong><span class="aip-muted">This source can only be imported as a whole.</span></div><div class="aip-setup-row"><span class="aip-setup-actions">${body}</span>${entry.error ? `<div class="aip-note aip-error">${esc(entry.error)}</div>` : ''}</div></div>`;
  }

  function renderOpened(agent) {
    let chats = '';
    if (agent.browsable) {
      const info = st.groups.get(agent.id);
      const tabs = `<div class="aip-tabs" role="tablist">
        <button type="button" role="tab" class="aip-tab${st.tab === 'projects' ? ' is-active' : ''}" aria-selected="${st.tab === 'projects'}" data-act="tab" data-tab="projects">Projects</button>
        <button type="button" role="tab" class="aip-tab${st.tab === 'chats' ? ' is-active' : ''}" aria-selected="${st.tab === 'chats'}" data-act="tab" data-tab="chats">Chats</button>
      </div>`;
      let body;
      if (!info || info.loading) body = '<div class="aip-note">Reading chat list…</div>';
      else if (info.error) body = `<div class="aip-note aip-error">${esc(info.error)} <button class="aip-link" type="button" data-act="reload-groups" data-agent="${esc(agent.id)}">Try again</button></div>`;
      else if (st.tab === 'projects') {
        body = info.groups.length || info.looseChats
          ? `<div class="aip-groups">${info.groups.map((group) => renderGroupRow(agent, group)).join('')}${info.looseChats ? renderLooseRow(agent, info.looseChats) : ''}</div>`
          : '<div class="aip-note">No chats found.</div>';
      } else {
        if (!st.lists.has(listKey(agent.id, ''))) setTimeout(() => loadChats(agent.id, ''), 0);
        body = renderChatList(agent, '', true);
      }
      chats = `${tabs}<div class="aip-tabpanel">${body}</div>`;
    } else if (agent.conversationSource) {
      chats = renderWholeSource(agent);
    }
    return `<div class="aip-opened">${chats}${renderSetup(agent)}${agent.browsable ? renderBar(agent) : ''}</div>`;
  }

  function renderBar(agent) {
    const sum = summarize(agent.id);
    const detail = [
      ...sum.groups.slice(0, 3).map((g) => `${g.label} (${g.selected === g.total ? `all ${g.total}` : `${g.selected} of ${g.total}`})`),
      ...(sum.groups.length > 3 ? [`${sum.groups.length - 3} more`] : []),
      ...(sum.loose ? [plural(sum.loose, 'loose chat')] : []),
    ].join(' · ');
    const lead = sum.total
      ? `<strong>${sum.groups.length ? `${plural(sum.groups.length, 'group')} · ` : ''}${plural(sum.total, 'chat')}</strong> selected`
      : 'Nothing selected yet';
    return `<div class="aip-bar" role="status" aria-live="polite">
      <div class="aip-bar-copy">${lead}${detail ? `<div class="aip-muted aip-bar-detail">${esc(detail)}</div>` : ''}</div>
      <button class="aip-btn aip-btn-ghost" type="button" data-act="clear" data-agent="${esc(agent.id)}" ${sum.total ? '' : 'disabled'}>Clear</button>
      <button class="aip-btn" type="button" data-act="import" data-agent="${esc(agent.id)}" ${sum.total && !st.run?.active ? '' : 'disabled'}>Import…</button>
    </div>`;
  }

  function renderRun() {
    const run = st.run;
    if (!run) return '';
    const current = run.current;
    const pct = run.total ? Math.round((run.done / run.total) * 100) : 0;
    const head = run.active
      ? `Importing from ${esc(run.agentName)}: ${run.done.toLocaleString()} of ${run.total.toLocaleString()} chats`
      : esc(run.summary || 'Import finished');
    const failures = run.failures.map((failure) => `<li><span>${esc(failure.text)}</span> <button class="aip-link" type="button" data-act="retry-job" data-job="${esc(failure.jobId)}" ${run.active ? 'disabled' : ''}>Retry</button></li>`).join('');
    return `<div class="aip-card aip-run" aria-live="polite">
      <div class="aip-run-head"><strong>${head}</strong>
        ${run.active ? `<button class="aip-btn aip-btn-ghost" type="button" data-act="cancel" ${run.cancelling ? 'disabled' : ''}>${run.cancelling ? 'Stopping after this chat…' : 'Cancel after current chat'}</button>` : '<button class="aip-link" type="button" data-act="dismiss-run">Dismiss</button>'}
      </div>
      <div class="aip-progress"><span style="width:${pct}%"></span></div>
      ${run.active && current ? `<div class="aip-muted">Now: ${esc(current)}</div>` : ''}
      ${failures ? `<ul class="aip-failures">${failures}</ul>` : ''}
    </div>`;
  }

  function renderFileForm() {
    const f = st.fileForm;
    if (!f.open) return '';
    const job = f.job;
    let result = '';
    if (job?.status === 'preview_ready' && f.kind === 'conversation') {
      const items = Array.isArray(job.preview?.conversationSummaries) ? job.preview.conversationSummaries : [];
      const shown = items.slice(0, f.shown);
      result = `<div class="aip-list-tools">
          <button class="aip-link" type="button" data-act="file-select-listed">Select all ${shown.length} listed</button>
          <span class="aip-muted">Applies only to the chats shown.</span>
        </div>
        <div class="aip-chats">${shown.map((item) => `<label class="aip-chat">${checkbox(f.picked.has(item.id), `data-act="file-chat" data-chat="${esc(item.id)}"`, item.title || 'chat')}<span class="aip-chat-copy"><span class="aip-chat-title">${esc(item.title || 'Untitled chat')}</span><span class="aip-chat-preview">${esc(item.projectName ? `Project: ${item.projectName}` : plural(item.messages || 0, 'message'))}</span></span><span class="aip-chat-meta"><span>${esc(formatDate(item.updatedAt))}</span></span></label>`).join('')}</div>
        ${items.length > shown.length ? `<button class="aip-btn aip-btn-ghost aip-more" type="button" data-act="file-more">Show more (${(items.length - shown.length).toLocaleString()} left)</button>` : ''}
        <div class="aip-bar"><div class="aip-bar-copy">${f.picked.size ? `<strong>${plural(f.picked.size, 'chat')}</strong> selected` : 'Nothing selected yet'}</div>
          <button class="aip-btn" type="button" data-act="file-confirm" ${f.picked.size && !f.busy ? '' : 'disabled'}>Import ${plural(f.picked.size, 'chat')}</button></div>`;
    } else if (job?.status === 'preview_ready' && f.kind === 'setup') {
      const n = Number(job.preview?.mcpServers || 0);
      result = `<div class="aip-bar"><div class="aip-bar-copy">${plural(n, 'MCP server')} found. Secrets are left behind.</div><button class="aip-btn" type="button" data-act="file-confirm" ${n && !f.busy ? '' : 'disabled'}>Import ${plural(n, 'MCP server')}</button></div>`;
    } else if (job) {
      result = `<div class="aip-note">${esc(String(job.progress?.message || job.error || job.status))}</div>`;
    }
    return `<div class="aip-card aip-file">
      <div class="aip-subhead"><strong>Import from a file or folder</strong><button class="aip-link" type="button" data-act="file-close">Close</button></div>
      <div class="aip-file-kind" role="radiogroup">
        <label><input type="radio" name="aip-file-kind" value="conversation" data-act="file-kind" ${f.kind === 'conversation' ? 'checked' : ''}> Chats (an export file or a transcript folder)</label>
        <label><input type="radio" name="aip-file-kind" value="setup" data-act="file-kind" ${f.kind === 'setup' ? 'checked' : ''}> MCP config file</label>
      </div>
      <div class="aip-file-row">
        <input class="aip-input" type="text" autocomplete="off" spellcheck="false" placeholder="Full path to a file or folder on this computer" value="${esc(f.path)}" data-field="file-path" aria-label="Path to a file or folder">
        <button class="aip-btn" type="button" data-act="file-preview" ${f.busy ? 'disabled' : ''}>${f.busy ? 'Reading…' : 'Preview'}</button>
      </div>
      ${f.error ? `<div class="aip-note aip-error">${esc(f.error)}</div>` : ''}
      ${result}
    </div>`;
  }

  function jobLabel(job) {
    const preview = job.preview || {};
    const result = job.result || {};
    const what = job.kind === 'setup'
      ? plural(result.mcpServerIds?.length || preview.mcpServers || 0, 'MCP server')
      : plural(Math.max(0, (result.sessionIds?.length || 0) - (result.skipped || 0)), 'chat');
    const status = { completed: 'imported', partial: 'partly imported', failed: 'failed', rolled_back: 'undone' }[job.status] || String(job.status || '').replace(/_/g, ' ');
    return `${job.sourceLabel || job.provider || 'Import'} · ${what} ${status}${result.skipped ? ` · ${result.skipped} already there` : ''}`;
  }

  function renderHistory() {
    const jobs = st.jobs.filter((job) => ['completed', 'partial', 'failed', 'rolled_back'].includes(String(job.status || ''))).slice(0, 30);
    return `<div class="aip-history">
      <button class="aip-history-toggle" type="button" data-act="history" aria-expanded="${st.historyOpen}">Import history &amp; undo <span class="aip-muted">(${jobs.length})</span><span class="aip-chev" aria-hidden="true">${st.historyOpen ? '⌄' : '›'}</span></button>
      ${st.historyOpen ? (jobs.length ? `<div class="aip-card">${jobs.map((job) => {
        const canUndo = ['completed', 'partial'].includes(job.status);
        const canRetry = ['partial', 'failed'].includes(job.status);
        return `<div class="aip-history-row"><span class="aip-history-copy"><strong>${esc(jobLabel(job))}</strong><span class="aip-muted">${esc(formatDate(Date.parse(job.updatedAt || '')))}</span></span>
          <span class="aip-history-actions">
            ${canRetry ? `<button class="aip-link" type="button" data-act="retry-job" data-job="${esc(job.id)}">Retry</button>` : ''}
            ${canUndo ? `<button class="aip-link" type="button" data-act="undo" data-job="${esc(job.id)}">Undo import</button>` : ''}
            ${!canUndo ? `<button class="aip-link aip-danger" type="button" data-act="delete-job" data-job="${esc(job.id)}">Remove record</button>` : ''}
          </span></div>`;
      }).join('')}</div>` : '<div class="aip-note">No imports yet. Undo removes only what that import created.</div>') : ''}
    </div>`;
  }

  function render() {
    let body;
    if (st.loading && !st.agents.length) body = '<div class="aip-card aip-note">Looking for agents on this computer…</div>';
    else if (st.error) body = `<div class="aip-card aip-note aip-error">${esc(st.error)}</div>`;
    else if (!st.agents.length) body = renderEmpty();
    else body = `<div class="aip-card aip-rows">${st.agents.map(renderRow).join('')}</div>`;
    const focusField = container.contains(document.activeElement) ? document.activeElement?.getAttribute?.('data-field') : '';
    container.innerHTML = `${renderHeader()}${renderRun()}${renderFileForm()}${body}
      <p class="aip-foot aip-muted">Finding an agent only lists its folders and file sizes. Chat titles and the last-message line are read when you open a row, shown here, and not saved. Login and credential files are never opened.</p>
      ${renderHistory()}`;
    container.querySelectorAll('input[data-indeterminate]').forEach((el) => { el.indeterminate = true; });
    if (focusField) {
      const el = container.querySelector(`[data-field="${focusField}"]`);
      if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* ignore */ } }
    }
  }

  // ---- confirmation dialog ----------------------------------------------------
  function confirmDialog(preflight) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'aip-dialog-overlay';
      const lines = preflight.groups.map((g) => `<li><span>${esc(g.label)}${g.kind === 'folder' ? ' <span class="aip-tag aip-tag-soft">grouped by folder</span>' : ''}</span><strong>${g.all ? `all ${plural(g.total, 'chat')}` : `${g.selected.toLocaleString()} of ${plural(g.total, 'chat')}`}</strong></li>`);
      if (preflight.looseChats) lines.push(`<li><span>Chats without a project</span><strong>${plural(preflight.looseChats, 'chat')}</strong></li>`);
      const n = preflight.toImport;
      overlay.innerHTML = `<div class="aip-dialog" role="dialog" aria-modal="true" aria-labelledby="aip-dialog-title">
        <h3 id="aip-dialog-title">Import from ${esc(preflight.agentName)}?</h3>
        <p class="aip-muted">Chats are copied into Prometheus as history. Old tool calls are never run again. You can undo this from Import history &amp; undo.</p>
        <ul class="aip-dialog-list">${lines.join('')}</ul>
        <div class="aip-dialog-totals">
          <div><span>Selected</span><strong>${plural(preflight.totalChats, 'chat')}${preflight.totalBytes ? ` · ${esc(formatBytes(preflight.totalBytes))}` : ''}</strong></div>
          <div><span>Already imported, will be skipped</span><strong>${preflight.alreadyImported.toLocaleString()}</strong></div>
          ${preflight.unknownChats ? `<div><span>No longer on disk, will be left out</span><strong>${preflight.unknownChats.toLocaleString()}</strong></div>` : ''}
        </div>
        <div class="aip-dialog-actions">
          <button class="aip-btn aip-btn-ghost" type="button" data-dlg="cancel">Cancel</button>
          <button class="aip-btn" type="button" data-dlg="ok" ${n > 0 ? '' : 'disabled'}>${n > 0 ? `Import ${plural(n, 'chat')}` : 'Nothing new to import'}</button>
        </div>
      </div>`;
      const close = (value) => { overlay.remove(); document.removeEventListener('keydown', onKey, true); resolve(value); };
      const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(false); } };
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close(false);
        const act = event.target.closest?.('[data-dlg]')?.getAttribute('data-dlg');
        if (act) close(act === 'ok');
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      overlay.querySelector('[data-dlg="ok"]:not([disabled])')?.focus();
    });
  }

  // ---- import run: per-chat progress, cancel after current, retry -------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function startImport(agentId) {
    const agent = agentById(agentId);
    if (!agent || st.run?.active) return;
    let preflight;
    try {
      const data = await call(`/api/imports/agents/${encodeURIComponent(agentId)}/preflight`, { method: 'POST', body: selectionRequest(agentId), timeoutMs: 180000 });
      preflight = data.preflight;
    } catch (error) {
      st.run = { active: false, agentName: agent.name, done: 0, total: 0, failures: [], summary: `Could not prepare the import: ${error.message}` };
      render();
      return;
    }
    if (!preflight || !(await confirmDialog(preflight))) return;
    const run = st.run = { active: true, agentName: agent.name, done: 0, total: preflight.totalChats, imported: 0, skipped: 0, failed: 0, current: '', failures: [], cancelling: false, jobId: '', summary: '' };
    render();
    let notStarted = 0;
    for (let index = 0; index < preflight.requests.length; index += 1) {
      const req = preflight.requests[index];
      if (run.cancelling) { notStarted += req.chatCount; continue; }
      let job;
      try {
        const created = await call('/api/imports/jobs', { method: 'POST', body: req, timeoutMs: 600000 });
        job = created.job;
        if (job.status !== 'preview_ready') throw new Error(job.error || job.preview?.unsupportedReason || 'This batch could not be read.');
        const ids = (job.preview?.conversationSummaries || []).map((item) => item.id);
        run.jobId = job.id;
        const confirmPromise = call(`/api/imports/jobs/${encodeURIComponent(job.id)}/confirm`, { method: 'POST', body: { confirm: true, conversationIds: ids }, timeoutMs: 3600000 });
        let finished = null;
        confirmPromise.then((data) => { finished = data.job; }, (error) => { finished = { status: 'failed', error: error.message, id: job.id }; });
        const base = run.done;
        while (!finished) {
          await sleep(POLL_MS);
          if (finished) break;
          try {
            const polled = (await call(`/api/imports/jobs/${encodeURIComponent(job.id)}`)).job;
            if (polled?.progress) {
              run.done = base + Math.min(req.chatCount, Number(polled.progress.completed || 0));
              run.current = String(polled.progress.message || '').replace(/^Importing\s+/, '');
              render();
            }
          } catch { /* keep waiting for the confirm call */ }
        }
        job = finished;
        const result = job.result || {};
        const processed = Number(job.progress?.total ?? req.chatCount) - Number(result.notStarted || 0);
        run.done = base + Math.min(req.chatCount, processed);
        run.skipped += Number(result.skipped || 0);
        run.failed += (result.failures || []).length;
        run.imported += Math.max(0, (result.sessionIds?.length || 0) - Number(result.skipped || 0));
        notStarted += Number(result.notStarted || 0) + Math.max(0, req.chatCount - Number(job.progress?.total ?? req.chatCount));
        for (const failure of result.failures || []) run.failures.push({ jobId: job.id, text: failure });
        if (job.status === 'failed' && !(result.failures || []).length) run.failures.push({ jobId: job.id, text: job.error || 'This batch failed.' });
      } catch (error) {
        run.failures.push({ jobId: job?.id || '', text: error.message });
        run.done += req.chatCount;
        run.failed += req.chatCount;
      }
      run.current = '';
      render();
    }
    run.active = false;
    const parts = [`${run.imported.toLocaleString()} imported`];
    if (run.skipped) parts.push(`${run.skipped.toLocaleString()} already there, skipped`);
    if (run.failed) parts.push(`${run.failed.toLocaleString()} failed`);
    if (notStarted) parts.push(`${notStarted.toLocaleString()} not started`);
    run.summary = parts.join(', ');
    st.selections.set(agentId, freshSelection());
    render();
    loadJobs();
  }

  async function retryJob(jobId) {
    if (!jobId) return;
    const run = st.run;
    try {
      const job = (await call(`/api/imports/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST', body: {}, timeoutMs: 3600000 })).job;
      if (run) {
        run.failures = run.failures.filter((failure) => failure.jobId !== jobId);
        for (const failure of job.result?.failures || []) run.failures.push({ jobId, text: failure });
        run.summary = `${run.summary.split(' · ')[0]} · retry ${job.status === 'completed' ? 'finished' : 'finished with problems'}`;
      }
    } catch (error) {
      if (run) run.failures.push({ jobId, text: `Retry failed: ${error.message}` });
    }
    render();
    loadJobs();
  }

  // ---- existing preview/confirm flows (MCP config, whole sources, file/folder)
  async function previewJob(body) {
    const data = await call('/api/imports/jobs', { method: 'POST', body, timeoutMs: 600000 });
    return data.job;
  }

  async function setupPreview(agentId, sourceId) {
    const source = agentById(agentId)?.setupSources?.find((item) => item.id === sourceId);
    if (!source) return;
    st.setup.set(sourceId, { busy: true });
    render();
    try {
      const job = await previewJob({ kind: 'setup', sourcePath: source.sourcePath, sourceLabel: source.label, adapter: 'setup-config', setupScope: 'mcp', overwrite: false });
      st.setup.set(sourceId, { job, busy: false, error: job.status === 'preview_ready' ? '' : (job.error || 'Could not read this config.') });
    } catch (error) {
      st.setup.set(sourceId, { busy: false, error: error.message });
    }
    render();
  }

  async function confirmJob(jobId, conversationIds) {
    const body = { confirm: true, ...(conversationIds ? { conversationIds } : {}) };
    return (await call(`/api/imports/jobs/${encodeURIComponent(jobId)}/confirm`, { method: 'POST', body, timeoutMs: 3600000 })).job;
  }

  async function setupConfirm(sourceId) {
    const entry = st.setup.get(sourceId);
    if (!entry?.job) return;
    st.setup.set(sourceId, { ...entry, busy: true });
    render();
    try {
      st.setup.set(sourceId, { job: await confirmJob(entry.job.id), busy: false, error: '' });
    } catch (error) {
      st.setup.set(sourceId, { ...entry, busy: false, error: error.message });
    }
    render();
    loadJobs();
  }

  async function wholePreview(agentId) {
    const source = agentById(agentId)?.conversationSource;
    if (!source) return;
    st.whole.set(agentId, { busy: true });
    render();
    try {
      const job = await previewJob({ kind: 'conversation', sourcePath: source.sourcePath, adapter: source.adapter, sourceLabel: source.label, conversationMode: 'projects', overwrite: false });
      st.whole.set(agentId, { job, busy: false, error: job.status === 'preview_ready' ? '' : (job.error || job.preview?.unsupportedReason || 'Could not read these chats.') });
    } catch (error) {
      st.whole.set(agentId, { busy: false, error: error.message });
    }
    render();
  }

  async function wholeConfirm(agentId) {
    const entry = st.whole.get(agentId);
    if (!entry?.job) return;
    const ids = (entry.job.preview?.conversationSummaries || []).map((item) => item.id);
    st.whole.set(agentId, { ...entry, busy: true });
    render();
    try {
      st.whole.set(agentId, { job: await confirmJob(entry.job.id, ids), busy: false, error: '' });
    } catch (error) {
      st.whole.set(agentId, { ...entry, busy: false, error: error.message });
    }
    render();
    loadJobs();
  }

  async function filePreview() {
    const f = st.fileForm;
    if (!f.path.trim()) { f.error = 'Enter the full path to a file or folder first.'; render(); return; }
    f.busy = true; f.error = ''; f.job = null; f.picked = new Set(); f.shown = PAGE_SIZE;
    render();
    try {
      const body = f.kind === 'setup'
        ? { kind: 'setup', sourcePath: f.path.trim(), adapter: 'setup-config', setupScope: 'mcp', overwrite: false }
        : { kind: 'conversation', sourcePath: f.path.trim(), conversationMode: 'projects', overwrite: false };
      f.job = await previewJob(body);
      if (f.job.status !== 'preview_ready') f.error = f.job.error || f.job.preview?.unsupportedReason || 'Could not read that file or folder.';
    } catch (error) {
      f.error = error.message;
    }
    f.busy = false;
    render();
  }

  async function fileConfirm() {
    const f = st.fileForm;
    if (!f.job) return;
    f.busy = true;
    render();
    try {
      f.job = await confirmJob(f.job.id, f.kind === 'conversation' ? [...f.picked] : undefined);
      f.picked = new Set();
    } catch (error) {
      f.error = error.message;
    }
    f.busy = false;
    render();
    loadJobs();
  }

  async function jobAction(jobId, action) {
    try {
      if (action === 'undo') {
        if (!window.confirm('Undo this import? Chats and projects it created are removed. Nothing else is touched.')) return;
        await call(`/api/imports/jobs/${encodeURIComponent(jobId)}/rollback`, { method: 'POST', body: { confirm: true } });
      } else if (action === 'delete') {
        await call(`/api/imports/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
      }
    } catch (error) {
      st.run = { active: false, agentName: '', done: 0, total: 0, failures: [], summary: `Could not ${action === 'undo' ? 'undo' : 'remove'} that import: ${error.message}` };
    }
    loadJobs();
  }

  async function cancelRun() {
    const run = st.run;
    if (!run?.active || run.cancelling) return;
    run.cancelling = true;
    render();
    if (run.jobId) {
      try { await call(`/api/imports/jobs/${encodeURIComponent(run.jobId)}/cancel`, { method: 'POST', body: {} }); } catch { /* the batch may have just finished */ }
    }
  }

  // ---- events -----------------------------------------------------------------
  container.addEventListener('click', (event) => {
    const el = event.target.closest('[data-act]');
    if (!el || !container.contains(el)) return;
    const act = el.getAttribute('data-act');
    const agentId = el.getAttribute('data-agent') || '';
    const group = el.getAttribute('data-group') || '';
    if (el.tagName === 'INPUT' && el.type === 'radio') return;
    switch (act) {
      case 'scan': scan(); break;
      case 'file-open': st.fileForm.open = true; render(); container.querySelector('[data-field="file-path"]')?.focus(); break;
      case 'file-close': st.fileForm = { ...st.fileForm, open: false, job: null, error: '', picked: new Set() }; render(); break;
      case 'file-preview': filePreview(); break;
      case 'file-confirm': fileConfirm(); break;
      case 'file-more': st.fileForm.shown += PAGE_SIZE; render(); break;
      case 'file-select-listed': {
        const items = (st.fileForm.job?.preview?.conversationSummaries || []).slice(0, st.fileForm.shown);
        items.forEach((item) => st.fileForm.picked.add(item.id));
        render();
        break;
      }
      case 'file-chat': {
        const id = el.getAttribute('data-chat');
        if (st.fileForm.picked.has(id)) st.fileForm.picked.delete(id); else st.fileForm.picked.add(id);
        render();
        break;
      }
      case 'open': openAgent(agentId); break;
      case 'tab': st.tab = el.getAttribute('data-tab') === 'chats' ? 'chats' : 'projects'; render(); break;
      case 'expand': {
        const key = listKey(agentId, group);
        if (st.expanded.has(key)) st.expanded.delete(key);
        else { st.expanded.add(key); if (!st.lists.has(key)) loadChats(agentId, group); }
        render();
        break;
      }
      case 'group': toggleGroup(agentId, group); render(); break;
      case 'chat': {
        const chat = { id: el.getAttribute('data-chat'), groupKey: group };
        toggleChat(agentId, chat);
        render();
        break;
      }
      case 'select-listed': {
        const items = st.lists.get(listKey(agentId, group))?.items || [];
        selectListed(agentId, items, el.getAttribute('data-on') === '1');
        render();
        break;
      }
      case 'more': loadChats(agentId, group, true); break;
      case 'reload-list': loadChats(agentId, group); break;
      case 'reload-groups': loadGroups(agentId); break;
      case 'clear': st.selections.set(agentId, freshSelection()); render(); break;
      case 'import': startImport(agentId); break;
      case 'cancel': cancelRun(); break;
      case 'dismiss-run': st.run = null; render(); break;
      case 'retry-job': retryJob(el.getAttribute('data-job')); break;
      case 'undo': jobAction(el.getAttribute('data-job'), 'undo'); break;
      case 'delete-job': jobAction(el.getAttribute('data-job'), 'delete'); break;
      case 'history': st.historyOpen = !st.historyOpen; render(); break;
      case 'setup-preview': setupPreview(agentId, el.getAttribute('data-source')); break;
      case 'setup-confirm': setupConfirm(el.getAttribute('data-source')); break;
      case 'whole-preview': wholePreview(agentId); break;
      case 'whole-confirm': wholeConfirm(agentId); break;
      case 'open-plugins': if (typeof options.openPlugins === 'function') options.openPlugins(); break;
      default: break;
    }
    if (el.tagName === 'INPUT' && el.type === 'checkbox') event.preventDefault();
  });
  container.addEventListener('change', (event) => {
    const el = event.target;
    if (el?.getAttribute?.('data-act') === 'file-kind') { st.fileForm.kind = el.value === 'setup' ? 'setup' : 'conversation'; st.fileForm.job = null; render(); }
  });
  container.addEventListener('input', (event) => {
    if (event.target?.getAttribute?.('data-field') === 'file-path') st.fileForm.path = event.target.value;
  });
  container.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target?.getAttribute?.('data-field') === 'file-path') { event.preventDefault(); filePreview(); }
  });

  scan();
  return ctl;
}
