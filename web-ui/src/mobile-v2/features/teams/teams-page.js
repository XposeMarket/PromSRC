import { ICONS } from '../../ui/icons.js';
import { escapeHtml, loading, errorState, safeJson, relativeTime } from '../../ui/page-kit.js';
import { mountStreamChatPanel } from '../shared/stream-chat-panel.js';

const TEAM_TABS = [
  ['context', 'Context'],
  ['subagents', 'Subagents'],
  ['workspace', 'Workspace'],
  ['memory', 'Memory'],
  ['runs', 'Runs'],
  ['chat', 'Team Chat'],
].map(([id, label]) => ({ id, label }));

const refreshIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2"/></svg>';
const legacyIcons = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.8c0-.8.9-1.3 1.6-.8l11.1 7.2c.6.4.6 1.2 0 1.6L8.6 20c-.7.5-1.6 0-1.6-.8V4.8Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 14h12l1-14M9 7V4h6v3"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};
const actionIcon = (name) => ICONS[name] || '';
const icon = (name) => legacyIcons[name] || actionIcon(name);

function teamId(team) {
  return String(team?.id || team?.teamId || team?.slug || '');
}

function teamName(team) {
  return String(team?.name || team?.title || team?.id || 'Team');
}

function teamEmoji(team) {
  const value = String(team?.emoji || '').trim();
  // The API can return icon identifiers (for example "team") in its emoji
  // field. The legacy Teams cards use a house glyph, so keep that treatment
  // instead of exposing the identifier as visible text.
  return value && !/^[a-z][a-z0-9_-]*$/i.test(value) ? value : '🏠';
}

function teamStatus(team) {
  return String(team?.status || team?.roomState?.status || (team?.paused ? 'paused' : 'active'));
}

function members(team) {
  const source = Array.isArray(team?.members)
    ? team.members
    : Array.isArray(team?.subagents)
      ? team.subagents
      : Array.isArray(team?.subagentIds)
        ? team.subagentIds
        : [];
  return source.map((member) => typeof member === 'string' ? { id: member, name: member } : member || {});
}

function agentCount(team) {
  if (Array.isArray(team?.agents)) return team.agents.length;
  const count = Number(team?.agents ?? team?.agentCount ?? team?.subagentsCount);
  return Number.isFinite(count) && count >= 0 ? count : members(team).length;
}

function teamStatusClass(status) {
  const value = String(status || '').toLowerCase();
  if (/run|active|work|online/.test(value)) return 'active';
  if (/fail|error|stall/.test(value)) return 'orange';
  return 'gray';
}

function teamTile(team, featuredId) {
  const id = teamId(team);
  const houseColor = team?.house === 'blue' ? '#4a82d1' : '#a4682b';
  const count = agentCount(team);
  return `<button class="pm-team-tile${id === featuredId ? ' featured' : ''}" data-team-id="${escapeHtml(id)}" type="button">
    ${id === featuredId ? '<span class="pm-star" aria-label="Featured">★</span>' : ''}
    <span class="pm-house" style="color:${houseColor}">${escapeHtml(teamEmoji(team))}</span>
    <span class="pm-team-name">${escapeHtml(teamName(team))}</span>
    <span class="pm-team-agents">${actionIcon('users')} ${count} agent${count === 1 ? '' : 's'}</span>
  </button>`;
}

function teamPreview(team) {
  const id = teamId(team);
  const list = members(team);
  const status = teamStatus(team);
  const workspace = String(team?.workspace || team?.workspacePath || team?.workspaceDir || 'Team workspace');
  const latestRun = team?.lastRunAt || team?.lastRun?.finishedAt || team?.lastRun?.startedAt;
  const currentTask = String(team?.currentTask || team?.task || team?.purpose || team?.description || 'No current task.');
  return `<section class="pm-team-preview">
    <div class="pm-team-preview-head">
      <span class="pm-mini-house">${escapeHtml(teamEmoji(team))}</span>
      <h3>${escapeHtml(teamName(team))}</h3>
      <button class="pm-pill-btn" type="button" data-open-team="${escapeHtml(id)}">View Team ${ICONS.chevron}</button>
    </div>
    <div style="font-size:13px;color:var(--pm-muted);font-weight:700;margin-top:4px">Team members</div>
    ${list.length ? `<div class="pm-chip-row">${list.slice(0, 8).map((member) => {
      const name = String(member?.name || member?.label || member?.id || 'Agent');
      return `<span class="pm-member-chip"><span class="pm-avatar">${escapeHtml(name.trim().slice(0, 1).toUpperCase() || 'A')}</span>${escapeHtml(name)}</span>`;
    }).join('')}${list.length > 8 ? `<span class="pm-member-chip">+${list.length - 8} more</span>` : ''}</div>` : '<div class="pm-team-preview-empty">No team members listed.</div>'}
    <div class="pm-divider"></div>
    <div class="pm-row"><span>🗂️ Workspace</span><span class="pm-team-preview-value">${escapeHtml(workspace)} ${ICONS.chevron}</span></div>
    <div class="pm-divider"></div>
    <div class="pm-row pm-team-preview-task"><span>Current task</span><strong>${escapeHtml(currentTask)}</strong></div>
    <div class="pm-row"><span>Status</span><span class="pm-pill ${teamStatusClass(status)}">${escapeHtml(status)}</span></div>
    <div class="pm-row"><span>Recent runs</span><strong>${escapeHtml(String(team?.runsDone ?? team?.completedRuns ?? 0))} / ${escapeHtml(String(team?.runsTotal ?? team?.totalRuns ?? 0))} runs</strong></div>
    ${latestRun ? `<div class="pm-row"><span>Last run</span><span class="pm-team-preview-value">${escapeHtml(relativeTime(latestRun) || '—')}</span></div>` : ''}
  </section>`;
}

function memberCard(member) {
  const name = String(member?.name || member?.label || member?.id || 'Agent');
  const id = String(member?.id || member?.agentId || member?.name || '');
  return `<section class="pm-card"><button class="pm-team-member-link" type="button" data-agent-id="${escapeHtml(id)}">
    <span class="pm-avatar">${escapeHtml(name.trim().slice(0, 1).toUpperCase() || 'A')}</span>
    <span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(member?.model || member?.role || member?.status || 'Team member')}</small></span>
    ${ICONS.chevron}
  </button></section>`;
}

function filePath(file) {
  return typeof file === 'string' ? file : String(file?.path || file?.relpath || file?.name || '');
}

function detailHeader(team) {
  const count = agentCount(team);
  const runCount = Number(team?.totalRuns ?? team?.runsTotal ?? 0) || 0;
  const status = teamStatus(team);
  return `<div class="pm-detail-head">
    <span class="pm-house-icon" style="color:#d8473a">${escapeHtml(teamEmoji(team))}</span>
    <h1>${escapeHtml(teamName(team))}</h1>
    ${ICONS.dots ? `<details class="pm-team-overflow"><summary class="pm-icon-btn pm-overflow" aria-label="More">${ICONS.dots}</summary><div class="pm-team-overflow-menu"><button type="button" data-team-action="review">${ICONS.spark} Review team</button></div></details>` : ''}
  </div>
  <div class="pm-detail-sub">${count} subagents · ${runCount} total runs · ${escapeHtml(status)}</div>`;
}

function detailActions(team) {
  const status = teamStatus(team);
  const toggle = /paused/i.test(status) ? 'resume' : 'pause';
  return `<div class="pm-action-row pm-team-actions">
    <button class="pm-action-btn primary" type="button" data-team-action="start">${icon('play')} Start Run</button>
    <button class="pm-action-btn" type="button" data-team-action="${toggle}">${icon(toggle === 'pause' ? 'pause' : 'play')} ${toggle === 'pause' ? 'Pause' : 'Resume'}</button>
    <button class="pm-action-btn" type="button" data-team-open-chat>${ICONS.chat} Chat</button>
    <button class="pm-action-btn danger" type="button" data-team-action="delete">${icon('trash')} Delete</button>
  </div>`;
}

function legacyTabs(active) {
  return `<div class="pm-tabs" role="tablist">${TEAM_TABS.map((tab) => `<button type="button" role="tab" aria-selected="${tab.id === active}" class="${tab.id === active ? 'active' : ''}" data-team-tab="${tab.id}">${escapeHtml(tab.label)}</button>`).join('')}</div>`;
}

export async function mountTeamsPage({ shell, features, route }) {
  shell.setActiveTab('chat');
  shell.setTitle(route?.id ? 'Team' : 'Teams');
  shell.renderHeader?.({ leftIcon: route?.id ? 'back' : 'menu', backRoute: 'teams', showStatus: Boolean(route?.id) });
  const page = shell.page;
  let disposed = false;
  let chatCleanup = () => {};

  async function list() {
    chatCleanup();
    page.innerHTML = `<div class="pm-title-row" style="margin-inline:-16px"><h1 class="pm-title">Teams</h1><span class="pm-count-pill" data-team-count>…</span><span class="pm-spacer"></span><button class="pm-icon-btn" type="button" aria-label="Refresh teams" data-team-refresh>${refreshIcon}</button></div><div class="pm-body-inner" data-team-list>${loading('Loading teams…')}</div>`;
    const host = page.querySelector('[data-team-list]');
    try {
      const rows = await features.teams();
      if (disposed) return;
      const teams = Array.isArray(rows) ? rows : [];
      page.querySelector('[data-team-count]').textContent = `${teams.length} team${teams.length === 1 ? '' : 's'}`;
      if (!teams.length) {
        host.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.users}</div><h2>No teams yet</h2><p>Create your first team from the desktop app.</p></div>`;
      } else {
        const featured = teams.find((team) => team?.featured) || teams[0];
        const featuredId = teamId(featured);
        host.innerHTML = `<div class="pm-team-grid">${teams.map((team) => teamTile(team, featuredId)).join('')}</div>${teamPreview(featured)}`;
      }
      page.querySelector('[data-team-refresh]')?.addEventListener('click', list);
      host.querySelectorAll('[data-team-id],[data-open-team]').forEach((button) => button.addEventListener('click', () => {
        const id = button.dataset.teamId || button.dataset.openTeam;
        if (id) shell.navigate?.(`teams/${encodeURIComponent(id)}`);
      }));
    } catch (error) {
      host.innerHTML = errorState(error);
      host.querySelector('[data-v2-retry]')?.addEventListener('click', list);
      page.querySelector('[data-team-refresh]')?.addEventListener('click', list);
    }
  }

  async function detail(id, initialTab = 'context') {
    chatCleanup();
    chatCleanup = () => {};
    page.innerHTML = `<div class="pm-team-detail-content" style="padding-top:calc(max(env(safe-area-inset-top), 12px) + 72px)">${loading('Loading team…')}</div>`;
    const content = page.querySelector('.pm-team-detail-content');
    try {
      const rows = await features.teams();
      const team = (Array.isArray(rows) ? rows : []).find((row) => teamId(row) === String(id));
      if (!team) throw new Error('Team not found.');
      if (disposed) return;

      const tabIds = TEAM_TABS.map((tab) => tab.id);
      let active = tabIds.includes(initialTab) ? initialTab : 'context';
      content.innerHTML = `${detailHeader(team)}${detailActions(team)}${legacyTabs(active)}<div data-team-tab-content></div>`;
      const host = content.querySelector('[data-team-tab-content]');

      async function renderTab(tab) {
        active = tab;
        content.querySelectorAll('[data-team-tab]').forEach((button) => {
          const selected = button.dataset.teamTab === active;
          button.classList.toggle('active', selected);
          button.setAttribute('aria-selected', String(selected));
        });
        chatCleanup();
        chatCleanup = () => {};
        if (tab === 'context') {
          const teamMembers = members(team);
          const refs = Array.isArray(team.contextReferences) ? team.contextReferences : Array.isArray(team.contextRefs) ? team.contextRefs : [];
          const task = String(team.currentTask || team.task || 'No current task.');
          const purpose = String(team.purpose || team.description || 'No purpose recorded.');
          const title = String(team.workspace || team.workspacePath || 'Team workspace');
          host.innerHTML = `<div class="pm-team-preview pm-team-detail-summary">
            <div class="pm-team-preview-head"><span class="pm-mini-house">${escapeHtml(teamEmoji(team))}</span><h3>${escapeHtml(teamName(team))}</h3></div>
            <div class="pm-team-detail-stats">${teamMembers.length} subagents · ${Number(team.totalRuns || team.runsTotal || 0)} total runs</div>
            ${teamMembers.length ? `<div class="pm-chip-row">${teamMembers.slice(0, 8).map((member) => { const name = String(member?.name || member?.label || member?.id || 'Agent'); return `<span class="pm-member-chip"><span class="pm-avatar">${escapeHtml(name.slice(0, 1).toUpperCase())}</span>${escapeHtml(name)}</span>`; }).join('')}</div>` : ''}
          </div>
            <section class="pm-card"><div class="pm-card-head">${icon('target')} Purpose <button class="pm-show-more" type="button" data-purpose-toggle>Show more ▾</button></div><div class="pm-card-body" data-purpose data-collapsed="1" style="display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(purpose)}</div></section>
          <div class="pm-card-grid">
            <section class="pm-card"><div class="pm-card-head">${icon('check')} Current Task / Goal</div><div class="pm-card-body">${escapeHtml(task)}</div></section>
            <section class="pm-card"><div class="pm-card-head">${icon('clock')} Last Run</div><div class="pm-card-body strong">${escapeHtml(relativeTime(team.lastRunAt || team.lastRun?.finishedAt || '') || '—')}</div></section>
            <section class="pm-card"><div class="pm-card-head">${ICONS.users} Member States</div><div class="pm-card-body">${escapeHtml(String(team.memberStates || team.state || teamStatus(team)))}</div></section>
            <section class="pm-card"><div class="pm-card-head">${ICONS.send} Active Dispatches</div><div class="pm-card-body">${escapeHtml(String(team.dispatches ?? team.activeDispatches ?? '—'))}</div></section>
          </div>
          <section class="pm-card"><div class="pm-card-head">${ICONS.doc} Context &amp; Reference</div><div class="pm-card-body pm-team-context-hint">Each save adds a reference to the team context.</div>
            ${refs.length ? `<div class="pm-team-context-list">${refs.map((ref) => `<div><strong>${escapeHtml(ref.title || ref.name || 'Reference')}</strong><span>${escapeHtml(ref.content || ref.body || ref.summary || ref.url || '')}</span></div>`).join('')}</div>` : '<div class="pm-team-context-empty">No context references saved yet.</div>'}
            <form data-team-context class="pm-team-context-form"><input class="pm-input" name="title" placeholder="Reference title" required/><textarea class="pm-textarea" name="body" placeholder="Reference content" required></textarea><div class="pm-row-buttons"><button class="pm-btn primary" type="submit">Save reference</button></div></form>
          </section>
          <section class="pm-card"><div class="pm-card-head">📁 Workspace Preview <button class="pm-pill-btn" type="button" data-team-tab-jump="workspace">Open Workspace ${ICONS.chevron}</button></div><div class="pm-card-body">${escapeHtml(title)}</div></section>`;

          const purposeToggle = host.querySelector('[data-purpose-toggle]');
          const purposeBody = host.querySelector('[data-purpose]');
          purposeToggle?.addEventListener('click', () => {
            const collapsed = purposeBody.dataset.collapsed === '1';
            purposeBody.style.display = collapsed ? 'block' : '-webkit-box';
            purposeBody.style.webkitLineClamp = collapsed ? 'unset' : '6';
            purposeBody.dataset.collapsed = collapsed ? '0' : '1';
            purposeToggle.textContent = collapsed ? 'Show less ▴' : 'Show more ▾';
          });
          host.querySelector('[data-team-tab-jump="workspace"]')?.addEventListener('click', () => renderTab('workspace'));
          host.querySelector('[data-team-context]')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = new FormData(form);
            try {
              await features.saveTeamContext(id, String(values.get('title') || ''), String(values.get('body') || ''));
              shell.showNotice('Team context saved.');
              await detail(id, 'context');
            } catch (error) {
              shell.showNotice(error?.message || 'Save failed.');
            }
          });
        } else if (tab === 'subagents') {
          const teamMembers = members(team);
          host.innerHTML = teamMembers.length ? `<div class="pm-team-member-list">${teamMembers.map(memberCard).join('')}</div>` : '<div class="pm-empty"><div class="pm-empty-icon">👥</div><h2>No team members</h2><p>This team does not list any subagents yet.</p></div>';
          host.querySelectorAll('[data-agent-id]').forEach((button) => button.addEventListener('click', () => {
            if (button.dataset.agentId) shell.navigate?.(`subagents/${encodeURIComponent(button.dataset.agentId)}`);
          }));
        } else if (tab === 'workspace' || tab === 'memory') {
          host.innerHTML = loading(tab === 'workspace' ? 'Loading workspace…' : 'Loading team memory…');
          const data = await features.teamWorkspace(id);
          if (disposed) return;
          const allFiles = Array.isArray(data?.files) ? data.files : [];
          const files = tab === 'memory' ? allFiles.filter((file) => /memory|last[-_ ]?run|pending/i.test(filePath(file))) : allFiles;
          host.innerHTML = files.length ? `<div class="pm-team-workspace-list">${files.map((file) => {
            const path = filePath(file);
            return `<button type="button" class="pm-team-workspace-file" data-team-file="${escapeHtml(path)}"><span>${ICONS.doc}</span><span>${escapeHtml(path)}</span>${ICONS.chevron}</button>`;
          }).join('')}</div><pre class="pm-team-file-content" data-team-file-content>${tab === 'memory' ? 'Select a memory file.' : 'Select a file.'}</pre>` : `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.doc}</div><h2>${tab === 'memory' ? 'No team memory files' : 'No workspace files'}</h2><p>${tab === 'memory' ? 'This team has not written memory artifacts yet.' : 'This team workspace is empty.'}</p></div>`;
          host.querySelectorAll('[data-team-file]').forEach((button) => button.addEventListener('click', async () => {
            const target = host.querySelector('[data-team-file-content]');
            target.textContent = 'Loading…';
            try {
              const result = await features.teamWorkspaceFile(id, button.dataset.teamFile);
              target.textContent = String(result?.content ?? safeJson(result));
            } catch (error) {
              target.textContent = error?.message || 'Failed to load file.';
            }
          }));
        } else if (tab === 'runs') {
          host.innerHTML = loading('Loading runs…');
          const result = await features.teamRuns(id);
          if (disposed) return;
          const runs = Array.isArray(result?.runs) ? result.runs : [];
          host.innerHTML = runs.length ? `<div class="pm-team-runs">${runs.map((run) => `<section class="pm-card"><div class="pm-card-head">${icon('clock')} ${escapeHtml(run.title || run.task || run.id || 'Run')}</div><div class="pm-card-body">${escapeHtml(run.status || run.state || 'Unknown status')}${run.startedAt ? ` · ${escapeHtml(relativeTime(run.startedAt))}` : ''}</div>${run.summary ? `<div class="pm-card-body pm-team-run-summary">${escapeHtml(run.summary)}</div>` : ''}</section>`).join('')}</div>` : '<div class="pm-empty"><div class="pm-empty-icon">◷</div><h2>No runs yet</h2><p>Start a run to see team activity here.</p></div>';
        } else if (tab === 'chat') {
          host.innerHTML = '<div data-team-chat></div>';
          chatCleanup = mountStreamChatPanel({ host: host.querySelector('[data-team-chat]'), loadMessages: () => features.teamChat(id), streamMessage: (message, options) => features.streamTeamChat(id, message, options), placeholder: 'Message the team…', emptyLabel: 'Start the team room conversation.' });
        }
      }

      content.querySelectorAll('[data-team-tab]').forEach((button) => button.addEventListener('click', () => renderTab(button.dataset.teamTab)));
      content.querySelector('[data-team-open-chat]')?.addEventListener('click', () => shell.navigate?.(`teams/${encodeURIComponent(id)}/chat`));
      content.querySelectorAll('[data-team-action]').forEach((button) => button.addEventListener('click', async () => {
        const action = button.dataset.teamAction;
        if (action === 'delete' && !confirm(`Delete ${teamName(team)}? This cannot be undone.`)) return;
        button.disabled = true;
        try {
          await features.teamAction(id, action);
          shell.showNotice(action === 'delete' ? 'Team deleted.' : `${action} requested.`);
          if (action === 'delete') shell.navigate?.('teams');
          else await detail(id, active);
        } catch (error) {
          shell.showNotice(error?.message || 'Team action failed.');
          button.disabled = false;
        }
      }));
      await renderTab(active);
    } catch (error) {
      content.innerHTML = errorState(error);
      content.querySelector('[data-v2-retry]')?.addEventListener('click', () => detail(id, initialTab));
    }
  }

  if (route?.id) await detail(route.id, route?.sub || 'context');
  else await list();
  return () => {
    disposed = true;
    chatCleanup();
  };
}
