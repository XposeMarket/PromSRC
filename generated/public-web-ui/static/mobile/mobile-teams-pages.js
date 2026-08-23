// Teams route owner. Loaded only when its route or a shared dependent feature is requested.
import {
  ICONS,
  PM_CHAT_VOICE_ICON_SRC,
  __pmChat,
  __pmVoice,
  _applyMobileAgentStreamEvent,
  _approvalFromMobileEvent,
  _buildMobileFileContextNote,
  _closeMobileQueuedPromptMenus,
  _ensureMobileQueuedPromptMenuDismiss,
  _formatTimeAgo,
  _installMobileTimestampReveal,
  _normalizeMobileApproval,
  _normalizeMobileFile,
  _renderChatAttachmentPreviews,
  _renderMobileAgentChatBubble,
  _renderMobileGoalPill,
  _renderMobileMarkdown,
  _renderMobileProcess,
  _resolveMobileApprovalButton,
  _restoreTemporaryMobileSubagentVoiceProfile,
  _setTemporaryMobileSubagentVoiceProfile,
  _uploadMobileChatAttachments,
  _wireMobileChatEnhancements,
  _wireMobileProcessRunActions,
  attachMobileButtonHaptic,
  deleteTeam,
  escapeHtml,
  getCachedMobilePageData,
  invalidateTeamsCache,
  loadMemoryGraph,
  loadMobileApprovals,
  loadMobileTeamDetail,
  loadMobileTeams,
  loadTeamChat,
  loadTeamChatStreamReplay,
  loadTeamRoomState,
  loadTeamRuns,
  loadTeamWorkspace,
  loadTeamWorkspaceFile,
  pauseTeam,
  pmToast,
  renderMobileHeader,
  renderVoicePage,
  resumeTeam,
  saveTeamContextReference,
  startTeamRun,
  streamTeamChat,
  triggerTeamReview,
  wireHeaderActions,
  wsEventBus,
} from './mobile-pages.js';

/* ---------------- TEAMS OVERVIEW ---------------- */
function teamTileHtml(t) {
  const houseColor = t.house === 'blue' ? '#4a82d1' : '#a4682b';
  return `
    <button class="pm-team-tile ${t.featured ? 'featured' : ''}" data-team="${t.id}">
      ${t.featured ? '<span class="pm-star">★</span>' : ''}
      <span class="pm-house" style="color:${houseColor}">🏠</span>
      <span class="pm-team-name">${escapeHtml(t.name)}</span>
      <span class="pm-team-agents">${ICONS.users} ${t.agents} agents</span>
    </button>
  `;
}

function teamsSkeletonHtml() {
  const tile = `<div class="pm-team-tile" style="opacity:.55"><span class="pm-house" style="opacity:.4">🏠</span><span class="pm-team-name" style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;height:16px;width:80%;">loading</span></div>`;
  return `<div class="pm-team-grid">${tile.repeat(4)}</div>`;
}

export async function renderTeamsPage(page, { navigate }) {
  const extras = `
    <span class="pm-count-pill" id="pm-teams-count">…</span>
    <span class="pm-spacer"></span>
    <button class="pm-icon-btn" id="pm-teams-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>
  `;
  const header = renderMobileHeader({ title: 'Teams', online: false, extras });
  page.innerHTML = `
    ${header}
    <div class="pm-body" id="pm-teams-body">${teamsSkeletonHtml()}</div>
  `;
  wireHeaderActions(page, {});

  const body = page.querySelector('#pm-teams-body');
  const countEl = page.querySelector('#pm-teams-count');
  const refresh = page.querySelector('#pm-teams-refresh');

  async function paint({ force = false } = {}) {
    let teams = [];
    try {
      teams = await loadMobileTeams({ force });
    } catch (err) {
      body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.users}</div><h2>Couldn’t load teams</h2><p>${escapeHtml(err.message || 'Network error')}</p></div>`;
      countEl.textContent = '0 teams';
      return;
    }

    countEl.textContent = `${teams.length} team${teams.length === 1 ? '' : 's'}`;
    if (!teams.length) {
      body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.users}</div><h2>No teams yet</h2><p>Create your first team from the desktop app.</p></div>`;
      return;
    }

    const featured = teams.find(t => t.featured) || teams[0];
    let detail = null;
    try { detail = await loadMobileTeamDetail(featured.id); } catch {}

    const previewHtml = detail ? `
      <div class="pm-team-preview">
        <div class="pm-team-preview-head">
          <span class="pm-mini-house">${escapeHtml(detail.emoji || '🏠')}</span>
          <h3>${escapeHtml(detail.name)}</h3>
          <button class="pm-pill-btn" data-go="${escapeHtml(detail.id)}">View Team ${ICONS.chev}</button>
        </div>
        <div style="font-size:13px;color:var(--pm-muted);font-weight:700;margin-top:4px;">Team members</div>
        <div class="pm-chip-row">
          ${detail.members.map(m => `<span class="pm-member-chip"><span class="pm-avatar" style="background:${m.color}">${m.avatar}</span>${escapeHtml(m.name)}</span>`).join('')}
        </div>
        <div class="pm-divider"></div>
        <div class="pm-row"><span>🗂️ Workspace</span><span style="color:var(--pm-muted)">${escapeHtml(detail.workspace)} ${ICONS.chev}</span></div>
        <div class="pm-divider"></div>
        <div class="pm-row" style="flex-direction:column;align-items:stretch;gap:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>Progress</strong>
            <span style="color:var(--pm-muted)">Recent runs <b style="color:var(--pm-text)">${detail.runsDone} / ${detail.runsTotal} runs</b></span>
          </div>
          <div class="pm-progress"><span style="width:${detail.runsTotal ? Math.round((detail.runsDone/detail.runsTotal)*100) : 0}%"></span></div>
        </div>
      </div>
    ` : '';

    body.innerHTML = `
      <div class="pm-team-grid">${teams.map(teamTileHtml).join('')}</div>
      ${previewHtml}
    `;
    body.querySelectorAll('[data-team]').forEach(btn => {
      btn.addEventListener('click', () => navigate(`#mobile/teams/${btn.getAttribute('data-team')}`));
    });
    body.querySelectorAll('[data-go]').forEach(btn => {
      btn.addEventListener('click', () => navigate(`#mobile/teams/${btn.getAttribute('data-go')}`));
    });
  }

  refresh.addEventListener('click', () => {
    invalidateTeamsCache();
    body.innerHTML = teamsSkeletonHtml();
    paint({ force: true });
  });

  const cachedTeams = getCachedMobilePageData('teams_raw', 21_600_000);
  await paint();
  if (Array.isArray(cachedTeams)) paint({ force: true }).catch(() => {});
}

/* ---------------- TEAM DETAIL ---------------- */
function teamDetailSkeleton() {
  return `
    <div class="pm-detail-head"><span class="pm-house-icon">🏠</span><h1 style="background:rgba(0,0,0,.06);color:transparent;border-radius:8px;height:24px;flex:1;">loading</h1></div>
    <div class="pm-detail-sub">…</div>
    <div class="pm-action-row">
      <button class="pm-action-btn primary">${ICONS.play} Start Run</button>
      <button class="pm-action-btn">${ICONS.pause} Pause</button>
      <button class="pm-action-btn">${ICONS.brain} Review</button>
      <button class="pm-action-btn danger">${ICONS.trash} Delete</button>
    </div>
    <div class="pm-card" style="opacity:.5"><div class="pm-card-head">${ICONS.target} Purpose</div><div class="pm-card-body">Loading team…</div></div>
  `;
}

export async function renderTeamDetailPage(page, { teamId, navigate, initialTab = '' }) {
  // Paint shell + skeleton first
  page.innerHTML = `
    <header class="pm-header">
      <button class="pm-icon-btn" data-action="back" aria-label="Back">${ICONS.back}</button>
            <button class="pm-icon-btn" data-action="settings" aria-label="Settings">${ICONS.gear}</button>
    </header>
    <div class="pm-body" id="pm-detail-body">${teamDetailSkeleton()}</div>
  `;
  wireHeaderActions(page, { onBack: () => navigate('#mobile/teams') });

  const body = page.querySelector('#pm-detail-body');

  let t = null;
  try {
    t = await loadMobileTeamDetail(teamId);
  } catch (err) {
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.users}</div><h2>Couldn’t load team</h2><p>${escapeHtml(err.message || 'Network error')}</p></div>`;
    return;
  }
  if (!t) {
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.users}</div><h2>Team not found</h2><p>This team isn’t available right now.</p></div>`;
    return;
  }

  const tabs = ['Context','Subagents','Workspace','Memory','Runs','Team Chat'];
  body.innerHTML = `
    <div class="pm-detail-head">
      <span class="pm-house-icon" style="color:#d8473a">${escapeHtml(t.emoji || '🎟️')}</span>
      <h1>${escapeHtml(t.name)}</h1>
      <button class="pm-icon-btn pm-overflow" aria-label="More">${ICONS.dots}</button>
    </div>
    <div class="pm-detail-sub">${t.subagents} subagents · ${t.totalRuns} total runs</div>

    <div class="pm-action-row">
      <button class="pm-action-btn primary" data-act="start">${ICONS.play} Start Run</button>
      <button class="pm-action-btn"          data-act="pause">${t.paused ? ICONS.play + ' Resume' : ICONS.pause + ' Pause'}</button>
      <button class="pm-action-btn"          data-act="review">${ICONS.brain} Review</button>
      <button class="pm-action-btn danger"   data-act="delete">${ICONS.trash} Delete</button>
    </div>

    <div class="pm-tabs" role="tablist">
      ${tabs.map((tab, i) => `<button class="${i === 0 ? 'active' : ''}" data-tab="${tab}">${escapeHtml(tab)}</button>`).join('')}
    </div>

    <div id="pm-tab-slot"></div>

    <div id="pm-context-slot">
    <div class="pm-team-preview">
      <div class="pm-team-preview-head">
        <span class="pm-mini-house">${escapeHtml(t.emoji || '🏠')}</span>
        <h3>${escapeHtml(t.name)}</h3>
      </div>
      <div style="font-size:13px;color:var(--pm-muted);">${t.subagents} subagents · ${t.totalRuns} total runs</div>
      <div class="pm-chip-row">
        ${t.members.map(m => `<span class="pm-member-chip"><span class="pm-avatar" style="background:${m.color}">${m.avatar}</span>${escapeHtml(m.name)}</span>`).join('')}
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>${ICONS.target} Purpose</span>
        <button class="pm-show-more" data-toggle-purpose>Show more ▾</button>
      </div>
      <div class="pm-card-body" data-purpose data-collapsed="1" style="display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(t.purpose)}</div>
    </div>

    <div class="pm-card-grid">
      <div class="pm-card">
        <div class="pm-card-head">${ICONS.check} Current Task / Goal</div>
        <div class="pm-card-body">${escapeHtml(t.currentTask)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${ICONS.clock} Last Run</div>
        <div class="pm-card-body strong">${escapeHtml(t.lastRun)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${ICONS.users} Member States</div>
        <div class="pm-card-body">${escapeHtml(t.memberStates)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${ICONS.send} Active Dispatches</div>
        <div class="pm-card-body">${escapeHtml(t.dispatches)}</div>
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head">${ICONS.doc} Context &amp; Reference</div>
      <div class="pm-card-body" style="margin-bottom:10px;">Each save adds a new card. Cards are injected into manager + subagent runtime context.</div>
      <input class="pm-input" id="pm-ref-title" placeholder="Reference title (e.g. Brand Voice, API URL, Posting Rules)" />
      <textarea class="pm-textarea" id="pm-ref-body" placeholder="Reference content…"></textarea>
      <div class="pm-row-buttons">
        <button class="pm-btn ghost" disabled title="Upload coming soon">${ICONS.upload} Upload File</button>
        <button class="pm-btn primary" data-save-ref>${ICONS.check} Save</button>
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>📁 Workspace Preview</span>
        <a href="#mobile/teams/${escapeHtml(teamId)}/workspace" style="color:var(--pm-orange);font-weight:700;text-decoration:none;font-size:13px;">Open Workspace ›</a>
      </div>
      <div class="pm-card-body">${escapeHtml(t.workspace)}</div>
    </div>
    </div><!-- /pm-context-slot -->
  `;

  // Tabs: swap visible content between context (default) and other tabs.
  const contextSlot = body.querySelector('#pm-context-slot');
  const tabSlot     = body.querySelector('#pm-tab-slot');

  async function selectTab(tabName) {
    try { tabSlot?._pmCleanup?.(); } catch {}
    if (tabSlot) tabSlot._pmCleanup = null;
    body.querySelectorAll('.pm-tabs button').forEach(x => x.classList.toggle('active', x.getAttribute('data-tab') === tabName));
    if (tabName === 'Context') {
      contextSlot.style.display = '';
      tabSlot.innerHTML = '';
      return;
    }
    contextSlot.style.display = 'none';
    tabSlot.innerHTML = `<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading ${escapeHtml(tabName)}…</div>`;
    try {
      if (tabName === 'Subagents')  await _renderSubagentsTab(tabSlot, t);
      else if (tabName === 'Runs')   await _renderRunsTab(tabSlot, teamId);
      else if (tabName === 'Team Chat') await _renderTeamChatTab(tabSlot, teamId);
      else if (tabName === 'Workspace') await _renderWorkspaceTab(tabSlot, teamId);
      else if (tabName === 'Memory')    await _renderMemoryTab(tabSlot, teamId, t);
    } catch (err) {
      tabSlot.innerHTML = `<div class="pm-card"><div class="pm-card-head">${ICONS.users} Error</div><div class="pm-card-body">${escapeHtml(err.message || 'Failed to load')}</div></div>`;
    }
  }

  body.querySelectorAll('.pm-tabs button').forEach(b => {
    b.addEventListener('click', () => selectTab(b.getAttribute('data-tab')));
  });
  const initialTabName = tabs.find(tab => tab.toLowerCase().replace(/\s+/g, '-') === String(initialTab || '').toLowerCase());
  if (initialTabName && initialTabName !== 'Context') selectTab(initialTabName);

  // Show more / less for purpose
  const purposeToggle = body.querySelector('[data-toggle-purpose]');
  const purposeBody = body.querySelector('[data-purpose]');
  if (purposeToggle && purposeBody) {
    purposeToggle.addEventListener('click', () => {
      const collapsed = purposeBody.getAttribute('data-collapsed') === '1';
      if (collapsed) {
        purposeBody.style.webkitLineClamp = 'unset';
        purposeBody.style.display = 'block';
        purposeBody.setAttribute('data-collapsed', '0');
        purposeToggle.textContent = 'Show less ▴';
      } else {
        purposeBody.style.display = '-webkit-box';
        purposeBody.style.webkitLineClamp = '6';
        purposeBody.setAttribute('data-collapsed', '1');
        purposeToggle.textContent = 'Show more ▾';
      }
    });
  }

  // Action buttons
  async function _action(btn, fn, doneMsg) {
    const prev = btn.innerHTML;
    btn.disabled = true;
    btn.style.opacity = '0.6';
    try {
      const r = await fn();
      if (!r || r.success === false) throw new Error(r?.error || 'Failed');
      pmToast(doneMsg, 'success');
      return r;
    } catch (err) {
      pmToast(err.message || 'Action failed', 'error');
      throw err;
    } finally {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.innerHTML = prev;
    }
  }

  body.querySelectorAll('[data-act]').forEach(btn => {
    const act = btn.getAttribute('data-act');
    btn.addEventListener('click', async () => {
      if (act === 'start') {
        await _action(btn, () => startTeamRun(teamId), 'Run started').catch(() => {});
      } else if (act === 'pause') {
        const willResume = t.paused;
        try {
          await _action(btn, () => (willResume ? resumeTeam(teamId) : pauseTeam(teamId)), willResume ? 'Team resumed' : 'Team paused');
          t.paused = !willResume;
          btn.innerHTML = t.paused ? `${ICONS.play} Resume` : `${ICONS.pause} Pause`;
        } catch {}
      } else if (act === 'review') {
        await _action(btn, () => triggerTeamReview(teamId), 'Manager review triggered').catch(() => {});
      } else if (act === 'delete') {
        if (!window.confirm(`Delete team "${t.name}"? This cannot be undone.`)) return;
        try {
          await _action(btn, () => deleteTeam(teamId), 'Team deleted');
          invalidateTeamsCache();
          navigate('#mobile/teams');
        } catch {}
      }
    });
  });

  // Save context reference
  const saveBtn = body.querySelector('[data-save-ref]');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const titleEl = body.querySelector('#pm-ref-title');
      const bodyEl  = body.querySelector('#pm-ref-body');
      const title = (titleEl.value || '').trim();
      const text  = (bodyEl.value  || '').trim();
      if (!title || !text) { pmToast('Title and content required', 'error'); return; }
      try {
        await _action(saveBtn, () => saveTeamContextReference(teamId, title, text), 'Reference saved');
        titleEl.value = '';
        bodyEl.value  = '';
      } catch {}
    });
  }

  page._pmCleanup = () => {
    try { tabSlot?._pmCleanup?.(); } catch {}
  };
}

/* ---------------- PLACEHOLDER ---------------- */
/* ---------------- TEAM DETAIL TABS ---------------- */

function _comingSoonHtml(title, subtitle) {
  return `<div class="pm-empty" style="padding:40px 20px;"><div class="pm-empty-icon">${ICONS.spark}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div>`;
}

const PRESENCE_PILL = {
  working:  { label: 'working',  cls: 'running' },
  active:   { label: 'active',   cls: 'active' },
  ready:    { label: 'ready',    cls: 'active' },
  idle:     { label: 'idle',     cls: 'gray' },
  blocked:  { label: 'blocked',  cls: 'orange' },
  paused:   { label: 'paused',   cls: 'gray' },
  awaiting: { label: 'awaiting', cls: 'orange' },
  offline:  { label: 'offline',  cls: 'gray' },
};



function _formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

async function _renderSubagentsTab(slot, team) {
  let roomState = null;
  try { roomState = await loadTeamRoomState(team.id); } catch {}
  const states = roomState?.memberStates || {};
  const dispatches = Array.isArray(roomState?.activeDispatches) ? roomState.activeDispatches : [];
  const activeByAgent = new Map();
  for (const d of dispatches) {
    const id = String(d.agentId || d.subagentId || '').trim();
    if (id) activeByAgent.set(id, d);
  }

  const cards = team.members.filter(m => m.id !== 'manager').map(m => {
    const s = states[m.id] || {};
    const pill = PRESENCE_PILL[String(s.status || 'idle').toLowerCase()] || PRESENCE_PILL.idle;
    const active = activeByAgent.get(m.id);
    return `
      <article class="pm-card">
        <div class="pm-schedule-head" style="margin-bottom:8px;">
          <span class="pm-emoji" style="font-size:22px;">${m.avatar}</span>
          <h3 style="margin:0;">${escapeHtml(m.name)}</h3>
          <span class="pm-pill ${pill.cls}">${pill.label}</span>
        </div>
        ${s.currentTask ? `<div class="pm-card-body" style="margin-bottom:6px;"><strong>Current:</strong> ${escapeHtml(s.currentTask)}</div>` : ''}
        ${s.blockedReason ? `<div class="pm-card-body" style="color:var(--pm-red);margin-bottom:6px;"><strong>Blocked:</strong> ${escapeHtml(s.blockedReason)}</div>` : ''}
        ${s.lastResult ? `<div class="pm-card-body" style="font-size:13px;color:var(--pm-muted);margin-bottom:6px;">Last: ${escapeHtml(String(s.lastResult).slice(0, 140))}${String(s.lastResult).length > 140 ? '…' : ''}</div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--pm-muted);">
          <span>${active ? `📡 dispatched` : 'Last update'}</span>
          <span>${_formatTimeAgo(s.lastUpdateAt || active?.startedAt)}</span>
        </div>
      </article>
    `;
  }).join('');

  slot.innerHTML = cards || `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.robot}</div><h2>No subagents yet</h2><p>Add members from the desktop team editor.</p></div>`;
}

function _runStatusPill(run) {
  if (run.inProgress) return '<span class="pm-pill running">running</span>';
  if (run.success === true) return '<span class="pm-pill active">success</span>';
  if (run.success === false && run.taskStatus) return `<span class="pm-pill orange">${escapeHtml(String(run.taskStatus))}</span>`;
  return '<span class="pm-pill gray">complete</span>';
}

async function _renderRunsTab(slot, teamId) {
  const { runs } = await loadTeamRuns(teamId, 30);
  if (!runs.length) {
    slot.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clock}</div><h2>No runs yet</h2><p>Start a run from the top of this page.</p></div>`;
    return;
  }
  slot.innerHTML = runs.map(r => `
    <article class="pm-card" style="padding:14px 16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <strong style="flex:1;font-size:14px;">${escapeHtml(r.agentName || r.agentId || 'Agent')}</strong>
        ${_runStatusPill(r)}
      </div>
      ${r.taskSummary ? `<div class="pm-card-body" style="margin-bottom:6px;">${escapeHtml(String(r.taskSummary).slice(0, 200))}${String(r.taskSummary).length > 200 ? '…' : ''}</div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--pm-muted);">
        <span>${escapeHtml(r.trigger || 'manual')} · ${r.stepCount || 0} steps</span>
        <span>${_formatTimeAgo(r.startedAt)} · ${_formatDuration(r.durationMs)}</span>
      </div>
    </article>
  `).join('');
}

function _mobileReplayFrameToEvent(frame) {
  if (!frame) return null;
  return { type: String(frame.type || frame.event || ''), ...(frame.data || {}) };
}





function _renderMobileStreamProcess(message) {
  const sourceEntries = [
    ...(Array.isArray(message?.processEntries) ? message.processEntries : []),
    ...(Array.isArray(message?.metadata?.processEntries) ? message.metadata.processEntries : []),
  ];
  const entries = sourceEntries.length
    ? sourceEntries.map((entry) => ({
        ...entry,
        type: String(entry?.type || 'info'),
        text: String(entry?.text || entry?.content || '').trim(),
      })).filter((entry) => entry.text)
    : [];
  return _renderMobileProcess(entries);
}







// Direct subagent history is persisted separately from the main-chat session.
// Promote the finalized presentation payload stored in its metadata so reopened
// turns retain the same files/artifacts end-of-turn UI as main chat.




function _renderMobileAgentChatList(listEl, messages, renderMessage) {
  if (!listEl) return;
  const expandedDrawers = new Set();
  const openToolGroups = new Set();
  listEl.querySelectorAll('.pm-agent-chat-msg').forEach((messageEl, messageIndex) => {
    const drawer = messageEl.querySelector('.pm-trace-drawer.open');
    if (drawer) expandedDrawers.add(messageIndex);
    messageEl.querySelectorAll('details.pm-trace-tool-group[open]').forEach((detail, detailIndex) => {
      openToolGroups.add(`${messageIndex}:${detail.getAttribute('data-pm-trace-group') || detailIndex}`);
    });
  });
  listEl.innerHTML = messages.map(renderMessage).join('');
  listEl.querySelectorAll('.pm-agent-chat-msg').forEach((messageEl, messageIndex) => {
    const drawer = messageEl.querySelector('.pm-trace-drawer');
    const timer = messageEl.querySelector('[data-expandable="trace"]');
    if (drawer && expandedDrawers.has(messageIndex)) {
      drawer.classList.add('open');
      timer?.classList.add('expanded');
    }
    messageEl.querySelectorAll('details.pm-trace-tool-group').forEach((detail, detailIndex) => {
      const key = `${messageIndex}:${detail.getAttribute('data-pm-trace-group') || detailIndex}`;
      if (openToolGroups.has(key) && !detail.closest('.pm-trace-drawer[data-trace-completed="1"]')) {
        detail.setAttribute('open', '');
      }
    });
  });
  _wireMobileChatEnhancements(listEl);
}

// Some subagent providers persist a final response with Markdown block
// boundaries flattened while preserving the Markdown tokens themselves, e.g.
// "Completed. ### Delivered - item". Repair only that unmistakable shape for
// display so the safe shared renderer can recover headings and lists without
// changing the stored response or ordinary prose.




const _mobileAgentComposerDrafts = {};









function _renderMobileAgentComposerHtml(prefix, placeholder) {
  const id = String(prefix || 'pm-agent-chat');
  return `
    <form class="pm-composer pm-agent-chat-composer" id="${id}-form" style="position:relative;left:auto;right:auto;bottom:auto;margin:0;border-radius:0;border-left:0;border-right:0;border-bottom:0;box-shadow:none;">
      <span class="pm-glass-lens" aria-hidden="true"></span>
      <span class="pm-glass-border" aria-hidden="true"></span>
      <input id="${id}-file-input" type="file" multiple accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.avi,.mkv,.txt,.md,.json,.csv,.tsv,.log,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.yaml,.yml,application/pdf" hidden />
      <div class="pm-attach-tray" id="${id}-attach-tray" hidden></div>
      <div class="pm-composer-row">
        <button type="button" class="pm-icon-btn" id="${id}-attach-btn" aria-label="Attach files">${ICONS.paperclip}</button>
        <div class="pm-composer-input-wrap" id="${id}-input-wrap">
          <textarea class="pm-composer-input" id="${id}-input" rows="1" placeholder="${escapeHtml(placeholder)}" aria-label="Message" autocomplete="off" autocapitalize="sentences" enterkeyhint="send"></textarea>
        </div>
        <button type="button" class="pm-icon-btn" id="${id}-mic-btn" aria-label="Voice input">${ICONS.micSmall}</button>
        <button type="submit" class="pm-send" id="${id}-send-btn" aria-label="Send">${ICONS.send}</button>
      </div>
      <div class="pm-chat-voice-shell" id="${id}-voice-shell" hidden>
        <button type="button" class="pm-chat-voice-camera" id="${id}-voice-camera" aria-label="Attach camera image">${ICONS.image}</button>
        <button type="button" class="pm-chat-voice-close" id="${id}-voice-close" aria-label="Close voice mode">&times;</button>
        <div class="pm-chat-voice-inline" id="${id}-voice-inline"></div>
      </div>
    </form>`;
}

function _installMobileAgentComposer(slot, prefix, { placeholder, isBusy, onSubmit, onAbort, draftKey = '', voiceTarget = null, onVoiceSubmit = null, openCameraCapture = null }) {
  const id = String(prefix || 'pm-agent-chat');
  const form = slot.querySelector(`#${id}-form`);
  const input = slot.querySelector(`#${id}-input`);
  const sendBtn = slot.querySelector(`#${id}-send-btn`);
  const attachBtn = slot.querySelector(`#${id}-attach-btn`);
  const micBtn = slot.querySelector(`#${id}-mic-btn`);
  const voiceShell = slot.querySelector(`#${id}-voice-shell`);
  const voiceClose = slot.querySelector(`#${id}-voice-close`);
  const voiceCamera = slot.querySelector(`#${id}-voice-camera`);
  const voiceHost = slot.querySelector(`#${id}-voice-inline`);
  const fileInput = slot.querySelector(`#${id}-file-input`);
  const attachTray = slot.querySelector(`#${id}-attach-tray`);
  const draftId = String(draftKey || '').trim();
  let draft = null;
  if (draftId) {
    if (!_mobileAgentComposerDrafts[draftId]) _mobileAgentComposerDrafts[draftId] = { text: '', pending: [] };
    draft = _mobileAgentComposerDrafts[draftId];
    if (!Array.isArray(draft.pending)) draft.pending = [];
  }
  const pending = draft ? draft.pending : [];
  let dictationEnabled = false;
  let dictationRecognition = null;
  let dictationSpeechRecognition = null;
  let dictationRestartTimer = null;
  let dictationGeneration = 0;
  if (input && draft?.text) input.value = draft.text;

  const resize = () => {
    if (!input) return;
    const viewportHeight = Math.max(320, Math.round(window.visualViewport?.height || window.innerHeight || 640));
    const dynamicCap = Math.max(96, Math.min(280, Math.floor(viewportHeight * 0.5) - 86));
    const maxHeight = Number(input.dataset.maxHeight || dynamicCap);
    input.style.height = 'auto';
    input.style.height = `${Math.min(maxHeight, Math.max(30, input.scrollHeight || 30))}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };
  const hasOutbound = () => !!(String(input?.value || '').trim() || pending.length);
  const hasVoiceTarget = () => voiceTarget && typeof onVoiceSubmit === 'function' && voiceShell && voiceHost;
  const updateExpandedState = () => {
    if (!form) return;
    form.classList.toggle('is-focused', document.activeElement === input);
    form.classList.toggle('has-text', !!String(input?.value || '').trim());
    form.classList.toggle('has-attachments', pending.length > 0);
  };
  const closeVoiceMode = () => {
    if (!voiceShell || !voiceHost) return;
    voiceShell.hidden = true;
    try { voiceHost._pmCleanup?.(); } catch {}
    voiceHost.innerHTML = '';
    _restoreTemporaryMobileSubagentVoiceProfile();
    if (__pmVoice?.target?.kind === 'subagent' && __pmVoice.target.agentId === voiceTarget?.agentId) {
      __pmVoice.target = null;
      __pmVoice.subagentSubmit = null;
    }
  };
  const openVoiceMode = async ({ autoStart = true } = {}) => {
    if (!hasVoiceTarget()) {
      pmToast('Voice mode is not available for this composer.', 'error');
      return;
    }
    const target = {
      kind: 'subagent',
      agentId: String(voiceTarget.agentId || '').trim(),
      label: String(voiceTarget.label || voiceTarget.name || 'Subagent').trim(),
      voice: voiceTarget.voice && typeof voiceTarget.voice === 'object' ? voiceTarget.voice : null,
    };
    __pmVoice.target = target;
    __pmVoice.targetSessionId = `subagent_chat_${target.agentId}`;
    __pmVoice.targetSessionLabel = target.label;
    __pmVoice.targetSessionChannel = 'subagent';
    __pmVoice.targetSessionForced = true;
    __pmVoice.subagentSubmit = async (text) => onVoiceSubmit({ text: String(text || '').trim(), files: [] });
    _setTemporaryMobileSubagentVoiceProfile(target.voice);
    voiceShell.hidden = false;
    voiceHost.innerHTML = '';
    await renderVoicePage(voiceHost, {
      inline: true,
      inlineChatSessionId: __pmVoice.targetSessionId,
      inlineChatSessionLabel: target.label,
      autoStart,
      openCameraCapture,
      cameraButton: voiceCamera,
    });
  };
  const renderAttachments = () => {
    if (!attachTray) return;
    attachTray.hidden = pending.length === 0;
    attachTray.innerHTML = _renderChatAttachmentPreviews(pending, true);
    attachTray.querySelectorAll('[data-remove-attachment]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-remove-attachment'));
        if (Number.isFinite(idx)) pending.splice(idx, 1);
        renderAttachments();
        update();
      });
    });
    updateExpandedState();
  };
  const update = () => {
    const busy = !!isBusy?.();
    const abortMode = busy && !hasOutbound();
    if (form) {
      form.classList.toggle('is-busy', busy);
      form.setAttribute('aria-busy', busy ? 'true' : 'false');
      form.dataset.composerState = busy ? (abortMode ? 'stopping' : 'busy') : 'idle';
    }
    if (input) input.placeholder = busy ? `Queue a message...` : placeholder;
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.classList.toggle('is-abort', abortMode);
      sendBtn.classList.toggle('is-voice', !busy && !hasOutbound() && hasVoiceTarget());
      sendBtn.title = abortMode ? 'Stop' : (!busy && !hasOutbound() && hasVoiceTarget()) ? 'Start voice mode' : busy ? 'Queue message' : 'Send';
      sendBtn.setAttribute('aria-label', abortMode ? 'Stop' : (!busy && !hasOutbound() && hasVoiceTarget()) ? 'Start voice mode' : busy ? 'Queue message' : 'Send');
      sendBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
      sendBtn.innerHTML = abortMode
        ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>`
        : (!busy && !hasOutbound() && hasVoiceTarget())
          ? `<img class="pm-send-voice-icon" src="${PM_CHAT_VOICE_ICON_SRC}" alt="" aria-hidden="true" />`
        : ICONS.send;
    }
    updateExpandedState();
  };
  const consume = () => {
    const text = String(input?.value || '').trim();
    const files = pending.splice(0, pending.length);
    if (input) {
      input.value = '';
      if (draft) draft.text = '';
      resize();
    }
    // Sending is the end of a dictation turn. Do not restart recognition after
    // clearing the composer, otherwise the mic remains visibly active and can
    // write a late transcript into the next message.
    if (dictationEnabled || dictationRecognition || dictationRestartTimer) {
      dictationEnabled = false;
      dictationGeneration += 1;
      if (dictationRestartTimer) clearTimeout(dictationRestartTimer);
      dictationRestartTimer = null;
      const recognition = dictationRecognition;
      dictationRecognition = null;
      try { recognition?.abort?.(); } catch {
        try { recognition?.stop?.(); } catch {}
      }
      micBtn?.classList.remove('listening');
    }
    renderAttachments();
    update();
    return { text, files };
  };

  const stopDictation = ({ refocus = true } = {}) => {
    dictationEnabled = false;
    dictationGeneration += 1;
    if (dictationRestartTimer) clearTimeout(dictationRestartTimer);
    dictationRestartTimer = null;
    const recognition = dictationRecognition;
    dictationRecognition = null;
    try { recognition?.stop?.(); } catch {
      try { recognition?.abort?.(); } catch {}
    }
    micBtn?.classList.remove('listening');
    if (refocus) input?.focus();
    resize();
    update();
  };
  const scheduleDictationCycle = (SpeechRecognition, delay = 140) => {
    if (dictationRestartTimer) clearTimeout(dictationRestartTimer);
    dictationRestartTimer = null;
    if (!dictationEnabled || dictationRecognition) return;
    dictationRestartTimer = setTimeout(() => {
      dictationRestartTimer = null;
      startDictationCycle(SpeechRecognition);
    }, delay);
  };
  const startDictationCycle = (SpeechRecognition) => {
    if (!dictationEnabled || dictationRecognition || !input) return;
    try {
      const recognition = new SpeechRecognition();
      const generation = dictationGeneration;
      const cycleStartValue = String(input.value || '').trimEnd();
      dictationRecognition = recognition;
      recognition.lang = navigator.language || 'en-US';
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.onstart = () => {
        if (generation === dictationGeneration) micBtn?.classList.add('listening');
      };
      recognition.onresult = (event) => {
        if (generation !== dictationGeneration) return;
        let finalTranscript = '';
        let interimTranscript = '';
        for (let index = 0; index < event.results.length; index += 1) {
          const transcript = String(event.results[index]?.[0]?.transcript || '');
          if (event.results[index].isFinal) finalTranscript += transcript;
          else interimTranscript += transcript;
        }
        const spoken = `${finalTranscript}${interimTranscript}`.trim();
        input.value = `${cycleStartValue}${cycleStartValue && spoken ? ' ' : ''}${spoken}`;
        if (draft) draft.text = input.value || '';
        resize();
        update();
      };
      recognition.onerror = (event) => {
        if (generation !== dictationGeneration) return;
        const error = String(event?.error || 'unknown');
        if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(error)) {
          dictationEnabled = false;
          pmToast(error === 'audio-capture' ? 'The microphone is not available.' : 'Microphone permission was denied.', 'error');
        } else if (!['no-speech', 'aborted'].includes(error)) {
          console.warn('[mobile agent chat] dictation cycle error:', error);
        }
      };
      recognition.onend = () => {
        if (generation !== dictationGeneration) return;
        if (dictationRecognition === recognition) dictationRecognition = null;
        resize();
        update();
        if (!dictationEnabled) {
          micBtn?.classList.remove('listening');
          return;
        }
        scheduleDictationCycle(SpeechRecognition);
      };
      recognition.start();
    } catch (err) {
      dictationRecognition = null;
      dictationEnabled = false;
      micBtn?.classList.remove('listening');
      pmToast(err?.message || 'Could not start dictation.', 'error');
    }
  };

  input?.addEventListener('input', () => {
    if (draft) draft.text = input.value || '';
    resize();
    update();
  });
  input?.addEventListener('focus', updateExpandedState);
  input?.addEventListener('blur', () => setTimeout(updateExpandedState, 0));
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form?.requestSubmit?.();
    }
  });
  input?.addEventListener('paste', async (event) => {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    if (!String(event.clipboardData?.getData?.('text/plain') || '').trim()) event.preventDefault();
    const normalized = await Promise.all(files.slice(0, 8).map(_normalizeMobileFile));
    pending.push(...normalized.filter(Boolean));
    renderAttachments();
    update();
  });
  attachBtn?.addEventListener('click', () => fileInput?.click());
  micBtn?.addEventListener('click', () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      pmToast('Speech dictation is not available in this browser.', 'error');
      return;
    }
    if (dictationEnabled) {
      stopDictation();
      return;
    }
    dictationSpeechRecognition = SpeechRecognition;
    dictationEnabled = true;
    dictationGeneration += 1;
    micBtn.classList.add('listening');
    pmToast('Listening until you tap the mic again.', 'info');
    startDictationCycle(SpeechRecognition);
  });
  voiceClose?.addEventListener('click', closeVoiceMode);
  voiceCamera?.addEventListener('click', () => {
    if (typeof openCameraCapture === 'function') openCameraCapture();
    else fileInput?.click();
  });
  fileInput?.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []).slice(0, 8);
    fileInput.value = '';
    if (!files.length) return;
    const normalized = await Promise.all(files.map(_normalizeMobileFile));
    pending.push(...normalized.filter(Boolean));
    renderAttachments();
    update();
  });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isBusy?.() && !hasOutbound()) {
      onAbort?.();
      update();
      return;
    }
    const payload = consume();
    if (!payload.text && !payload.files.length) {
      await openVoiceMode({ autoStart: true });
      return;
    }
    await onSubmit?.(payload);
    update();
  });

  const previousCleanup = slot._pmCleanup;
  slot._pmCleanup = () => {
    stopDictation({ refocus: false });
    closeVoiceMode();
    previousCleanup?.();
  };
  requestAnimationFrame(() => { renderAttachments(); resize(); update(); });
  return { input, update, consume, pending };
}









































































async function _renderTeamChatTab(slot, teamId) {
  slot.innerHTML = `
    <div class="pm-card pm-team-chat-card" id="pm-team-chat-card">
      <div id="pm-team-chat-list" class="pm-team-chat-list" aria-live="polite">
        <div class="pm-team-chat-status">Loading team chat&hellip;</div>
      </div>
      <div id="pm-team-chat-queue" class="pm-mobile-queued-prompts" hidden></div>
      <div id="pm-team-chat-goal" class="pm-mobile-goal-strip pm-mobile-goal-strip-inline" hidden></div>
      ${_renderMobileAgentComposerHtml('pm-team-chat', 'Message the team manager...')}
    </div>
  `;

  const listEl = slot.querySelector('#pm-team-chat-list');
  const queueEl = slot.querySelector('#pm-team-chat-queue');
  const goalEl = slot.querySelector('#pm-team-chat-goal');
  _installMobileTimestampReveal(listEl, () => {});
  _renderMobileGoalPill(goalEl, __pmChat.activeSessionId, { fallbackToLast: true });
  let messages = [];
  let liveMsg = null;
  let currentStream = null;
  let lastSeq = 0;
  let lastStreamId = '';
  let localSseActive = false;
  let cleanupDone = false;
  const sendQueue = [];
  let approvalCards = [];
  let composer = null;

  function normalizeTeamChatMessage(message = {}) {
    const body = message?.body && typeof message.body === 'object' ? message.body : {};
    const metadata = message?.metadata && typeof message.metadata === 'object' ? message.metadata : {};
    const from = String(message?.from || message?.role || '').toLowerCase();
    const fromUser = from === 'user' || from === 'you' || from === 'human';
    const content = String(message?.content || message?.message || message?.text || body.text || '');
    return {
      ...message,
      role: fromUser ? 'user' : 'agent',
      from: fromUser ? 'user' : (from || 'manager'),
      fromLabel: message?.fromLabel || message?.fromName || body.sender || (fromUser ? 'You' : 'Manager'),
      content,
      body: { ...body, text: content },
      createdAt: message?.createdAt || message?.timestamp || message?.ts || Date.now(),
      processEntries: Array.isArray(message?.processEntries)
        ? message.processEntries
        : (Array.isArray(metadata.processEntries) ? metadata.processEntries : []),
    };
  }

  function renderTeamChatMessage(message) {
    const normalized = normalizeTeamChatMessage(message);
    try {
      return _renderMobileAgentChatBubble(normalized, {
        sender: normalized.fromLabel,
        live: message === liveMsg,
        keepLiveTraceVisible: message === liveMsg,
      });
    } catch (err) {
      // Team history should remain readable even when a legacy or unusually
      // shaped message cannot use the richer chat renderer.
      console.warn('[mobile team chat] rich message render failed:', err);
      const fromUser = normalized.role === 'user';
      return `<div class="pm-msg ${fromUser ? 'from-user' : 'from-ai'} pm-agent-chat-msg">
        <div class="pm-bubble">
          ${fromUser ? '' : `<span class="pm-sender">${escapeHtml(normalized.fromLabel)}</span>`}
          <div class="markdown-body">${_renderMobileMarkdown(normalized.content)}</div>
        </div>
      </div>`;
    }
  }

  const isBusy = () => !!(currentStream || liveMsg?.streaming || localSseActive);
  const approvalBelongsHere = (approvalInput = {}) => {
    const approval = _normalizeMobileApproval(approvalInput);
    const sid = String(approval.sessionId || approval.sourceSessionId || '').trim();
    return !!approval.id && (
      sid.startsWith(`team_dm_manager_${teamId}___`)
      || sid.startsWith(`team_dm_member_${teamId}___`)
      || sid === `team_chat_${teamId}`
      || String(approval.teamId || approval.toolArgs?.teamId || '').trim() === String(teamId)
    );
  };
  const upsertApprovalCard = (approvalInput = {}) => {
    if (!approvalBelongsHere(approvalInput)) return false;
    const approval = _normalizeMobileApproval(approvalInput);
    const idx = approvalCards.findIndex((item) => String(item?.approvalRequest?.id || '') === approval.id);
    const msg = {
      role: 'agent',
      from: 'manager',
      fromLabel: 'Manager',
      content: '',
      createdAt: Date.now(),
      approvalRequest: approval,
    };
    if (idx >= 0) approvalCards[idx] = { ...approvalCards[idx], approvalRequest: { ...(approvalCards[idx].approvalRequest || {}), ...approval } };
    else approvalCards.push(msg);
    approvalCards = approvalCards.slice(-8);
    return true;
  };
  const updateApprovalCard = (id, status, event = {}) => {
    const approvalId = String(id || '').trim();
    if (!approvalId) return false;
    const idx = approvalCards.findIndex((item) => String(item?.approvalRequest?.id || '') === approvalId);
    if (idx < 0) return false;
    approvalCards[idx].approvalRequest = _normalizeMobileApproval({ ...(approvalCards[idx].approvalRequest || {}), ...(event.approval || event), id: approvalId, status });
    return true;
  };
  const restoreApprovalCards = async () => {
    const pending = await loadMobileApprovals('pending').catch(() => []);
    (Array.isArray(pending) ? pending : []).forEach(upsertApprovalCard);
  };

  function renderQueue() {
    if (!queueEl) return;
    queueEl.hidden = sendQueue.length === 0;
    queueEl.innerHTML = sendQueue.length
      ? `<div class="pm-mobile-queued-list">${sendQueue.map((item, idx) => `
           <div class="pm-mobile-queued-item">
             <button type="button" class="pm-mobile-queued-text" data-team-queue-edit="${idx}">${escapeHtml(String(item.text || 'Attached file(s)').slice(0, 120))}${item.files?.length ? ` <em>+${item.files.length}</em>` : ''}</button>
             <div class="pm-mobile-queued-actions">
               <div class="pm-mobile-queued-menu-wrap">
                 <button type="button" class="pm-mobile-queued-icon pm-mobile-queued-menu-trigger" data-team-queue-menu="${idx}" aria-label="Queued message actions" title="Actions">${ICONS.dots}</button>
                 <div class="pm-mobile-queued-popover" data-team-queue-menu-popover="${idx}" hidden>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-steer" data-team-queue-steer="${idx}">${ICONS.target}<span>Steer</span></button>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-remove" data-team-queue-remove="${idx}">${ICONS.trash}<span>Delete</span></button>
                 </div>
               </div>
             </div>
           </div>`).join('')}</div>`
      : '';
    _ensureMobileQueuedPromptMenuDismiss();
    queueEl.querySelectorAll('[data-team-queue-edit]').forEach((btn) => attachMobileButtonHaptic(btn, () => {}));
    queueEl.querySelectorAll('[data-team-queue-menu]').forEach((btn) => attachMobileButtonHaptic(btn, () => {
      const idx = Number(btn.getAttribute('data-team-queue-menu'));
      if (!Number.isInteger(idx)) return;
      const menu = queueEl.querySelector(`[data-team-queue-menu-popover="${idx}"]`);
      if (!menu) return;
      const nextOpen = !!menu.hidden;
      _closeMobileQueuedPromptMenus(queueEl);
      menu.hidden = !nextOpen;
    }));
    queueEl.querySelectorAll('[data-team-queue-steer]').forEach((btn) => attachMobileButtonHaptic(btn, () => {
      const idx = Number(btn.getAttribute('data-team-queue-steer'));
      if (Number.isFinite(idx) && idx >= 0 && idx < sendQueue.length) {
        const [item] = sendQueue.splice(idx, 1);
        if (item) sendQueue.unshift(item);
      }
      _closeMobileQueuedPromptMenus(queueEl);
      renderQueue();
      drainQueueSoon();
    }));
    queueEl.querySelectorAll('[data-team-queue-remove]').forEach((btn) => attachMobileButtonHaptic(btn, () => {
      const idx = Number(btn.getAttribute('data-team-queue-remove'));
      if (Number.isFinite(idx)) sendQueue.splice(idx, 1);
      _closeMobileQueuedPromptMenus(queueEl);
      renderQueue();
    }));
  }

  function drainQueueSoon() {
    if (isBusy() || !sendQueue.length) {
      composer?.update?.();
      return;
    }
    const next = sendQueue.shift();
    renderQueue();
    startTeamMobileSend(next).catch((err) => pmToast(err?.message || 'Send failed', 'error'));
  }

  function upsertServerMessages(fresh) {
    const localLive = liveMsg && !liveMsg._done ? liveMsg : null;
    messages = Array.isArray(fresh) ? fresh.slice() : [];
    if (localLive) {
      const duplicate = messages.some((m) =>
        String(m.content || m.message || m.text || '').trim()
        && String(m.content || m.message || m.text || '').trim() === String(localLive.content || '').trim()
      );
      if (!duplicate) messages.push(localLive);
    }
  }

  function renderList() {
    const visibleApprovals = approvalCards.filter((m) => String(m?.approvalRequest?.status || 'pending') === 'pending');
    const rendered = [...messages, ...visibleApprovals];
    if (!rendered.length) {
      listEl.innerHTML = `<div style="text-align:center;color:var(--pm-muted);padding:24px 8px;font-size:13px;">No messages yet. Send the first one.</div>`;
      return;
    }
    _renderMobileAgentChatList(listEl, rendered, renderTeamChatMessage);
    listEl.querySelectorAll('[data-pm-approval-action][data-pm-approval-id]').forEach((btn) => {
      btn.addEventListener('click', () => _resolveMobileApprovalButton(btn));
    });
    _wireMobileProcessRunActions(listEl);
    listEl.scrollTop = listEl.scrollHeight;
  }

  try {
    upsertServerMessages(await loadTeamChat(teamId, 80));
    await restoreApprovalCards();
    renderList();
  } catch (err) {
    listEl.innerHTML = `<div style="color:var(--pm-red);padding:16px;">${escapeHtml(err.message || 'Failed to load chat')}</div>`;
  }

  async function reconcile({ forceHistory = false } = {}) {
    try {
      const replay = await loadTeamChatStreamReplay(teamId, lastStreamId ? lastSeq : 0);
      if (replay.stream?.streamId && replay.stream.streamId !== lastStreamId) {
        lastStreamId = replay.stream.streamId;
        lastSeq = 0;
      }
      if (replay.stream?.streamId && !liveMsg && replay.active) {
        liveMsg = { role: 'manager', from: 'manager', fromLabel: 'Manager', content: '', _progress: 'Reconnecting...', createdAt: Date.now(), workStartedAt: Date.now(), streaming: true, processEntries: [] };
        messages.push(liveMsg);
      }
      for (const frame of replay.events || []) {
        if (frame.streamId) lastStreamId = frame.streamId;
        lastSeq = Math.max(lastSeq, Number(frame.seq || 0));
        if (!liveMsg) {
          liveMsg = { role: 'manager', from: 'manager', fromLabel: 'Manager', content: '', _progress: 'Reconnecting...', createdAt: Date.now(), workStartedAt: Date.now(), streaming: true, processEntries: [] };
          messages.push(liveMsg);
        }
        _applyMobileAgentStreamEvent(liveMsg, _mobileReplayFrameToEvent(frame), 'Manager');
      }
      if (forceHistory || !replay.active || liveMsg?._done) {
        upsertServerMessages(await loadTeamChat(teamId, 80));
        await restoreApprovalCards();
        if (!replay.active) liveMsg = null;
      }
      renderList();
    } catch {}
  }

  const onWsOpen = () => reconcile({ forceHistory: true });
  const onVisibility = () => { if (!document.hidden) reconcile({ forceHistory: true }); };
  const onTeamChatMessage = async (msg = {}) => {
    if (String(msg.teamId || '') !== String(teamId)) return;
    try {
      upsertServerMessages(await loadTeamChat(teamId, 80));
      liveMsg = null;
      renderList();
    } catch {}
  };
  const onTeamChatStreamEvent = (msg = {}) => {
    if (String(msg.teamId || '') !== String(teamId)) return;
    if (localSseActive) return;
    if (msg.streamId && msg.streamId !== lastStreamId) {
      lastStreamId = msg.streamId;
      lastSeq = 0;
    }
    lastSeq = Math.max(lastSeq, Number(msg.seq || 0));
    if (!liveMsg) {
      liveMsg = { role: 'manager', from: 'manager', fromLabel: 'Manager', content: '', _progress: 'Thinking...', createdAt: Date.now(), workStartedAt: Date.now(), streaming: true, processEntries: [] };
      messages.push(liveMsg);
    }
    _applyMobileAgentStreamEvent(liveMsg, { type: String(msg.event || ''), ...(msg.data || {}) }, 'Manager');
    renderList();
  };
  const onApprovalCreated = async (msg = {}) => {
    const approval = msg.approval ? _normalizeMobileApproval(msg.approval, msg) : await _approvalFromMobileEvent(msg);
    if (upsertApprovalCard(approval)) renderList();
  };
  const onApprovalResolved = (eventName) => (msg = {}) => {
    const status = eventName === 'approval_approved' ? 'approved'
      : eventName === 'approval_denied' ? 'rejected'
        : eventName === 'approval_expired' ? 'expired'
          : 'failed';
    if (updateApprovalCard(msg.approvalId || msg.id || msg.approval?.id, status, msg)) renderList();
  };
  const onApprovalApproved = onApprovalResolved('approval_approved');
  const onApprovalDenied = onApprovalResolved('approval_denied');
  const onApprovalExpired = onApprovalResolved('approval_expired');
  const onApprovalFailed = onApprovalResolved('approval_failed');
  wsEventBus?.on?.('ws:open', onWsOpen);
  wsEventBus?.on?.('team_chat_message', onTeamChatMessage);
  wsEventBus?.on?.('team_chat_stream_event', onTeamChatStreamEvent);
  wsEventBus?.on?.('approval_created', onApprovalCreated);
  wsEventBus?.on?.('approval_approved', onApprovalApproved);
  wsEventBus?.on?.('approval_denied', onApprovalDenied);
  wsEventBus?.on?.('approval_expired', onApprovalExpired);
  wsEventBus?.on?.('approval_failed', onApprovalFailed);
  document.addEventListener('visibilitychange', onVisibility);
  slot._pmCleanup = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    try { currentStream?.abort?.(); } catch {}
    wsEventBus?.off?.('ws:open', onWsOpen);
    wsEventBus?.off?.('team_chat_message', onTeamChatMessage);
    wsEventBus?.off?.('team_chat_stream_event', onTeamChatStreamEvent);
    wsEventBus?.off?.('approval_created', onApprovalCreated);
    wsEventBus?.off?.('approval_approved', onApprovalApproved);
    wsEventBus?.off?.('approval_denied', onApprovalDenied);
    wsEventBus?.off?.('approval_expired', onApprovalExpired);
    wsEventBus?.off?.('approval_failed', onApprovalFailed);
    document.removeEventListener('visibilitychange', onVisibility);
  };
  reconcile();

  async function startTeamMobileSend(payload) {
    const rawText = String(payload?.text || '').trim();
    const files = Array.isArray(payload?.files) ? payload.files : [];
    const source = String(payload?.source || '').trim();
    const userVisibleText = rawText || (files.length ? 'Please review the attached file(s).' : '');
    if (!userVisibleText && !files.length) return;
    if (isBusy()) {
      sendQueue.push({ text: rawText, files, source, speak: payload?.speak === true, voice: payload?.voice === true });
      renderQueue();
      composer?.update?.();
      return;
    }
    let messageForRuntime = userVisibleText;
    let attachmentPreviews = files;
    if (files.length) {
      const uploadResults = await _uploadMobileChatAttachments(files);
      messageForRuntime = `${userVisibleText}${_buildMobileFileContextNote(uploadResults)}`;
      attachmentPreviews = uploadResults.map((r, idx) => ({
        ...(files[idx] || {}),
        name: r.name || files[idx]?.name || 'attachment',
        kind: r.isImage ? 'image' : (r.isVideo ? 'video' : (files[idx]?.kind || 'file')),
        workspacePath: r.workspacePath || files[idx]?.workspacePath,
        path: r.workspacePath || files[idx]?.path,
        dataUrl: files[idx]?.dataUrl,
        mimeType: files[idx]?.mimeType,
        sizeLabel: files[idx]?.sizeLabel,
      }));
    }
    const userMsg = { role: 'user', from: 'user', content: userVisibleText, body: { text: userVisibleText, attachments: attachmentPreviews }, attachmentPreviews, createdAt: Date.now() };
    liveMsg = { role: 'manager', from: 'manager', fromLabel: 'Manager', content: '', _progress: 'Manager is thinking...', createdAt: Date.now(), workStartedAt: Date.now(), streaming: true, processEntries: [] };
    messages.push(userMsg, liveMsg);
    renderList();
    localSseActive = true;
    composer?.update?.();
    currentStream = streamTeamChat(teamId, { message: messageForRuntime }, {
      onEvent: (evt) => {
        _applyMobileAgentStreamEvent(liveMsg, evt, 'Manager');
        renderList();
      },
      onError: (err) => {
        if (err?.name === 'AbortError') return;
        liveMsg.content = liveMsg.content || `Error: ${err?.message || 'stream failed'}`;
        liveMsg._progress = '';
        liveMsg.streaming = false;
        liveMsg.workEndedAt = Date.now();
        localSseActive = false;
        currentStream = null;
        composer?.update?.();
        renderList();
        pmToast(err?.message || 'Send failed', 'error');
      },
      onDone: async () => {
        if (liveMsg) {
          liveMsg._progress = '';
          liveMsg.streaming = false;
          liveMsg.workEndedAt = liveMsg.workEndedAt || Date.now();
          liveMsg.workDurationMs = Math.max(0, liveMsg.workEndedAt - Number(liveMsg.workStartedAt || liveMsg.createdAt || liveMsg.workEndedAt));
        }
        localSseActive = false;
        currentStream = null;
        composer?.update?.();
        await reconcile({ forceHistory: true });
        drainQueueSoon();
      },
    });
  }

  composer = _installMobileAgentComposer(slot, 'pm-team-chat', {
    placeholder: 'Message the team manager...',
    draftKey: 'team:manager',
    isBusy,
    onAbort: () => {
      try { currentStream?.abort?.(); } catch {}
      if (liveMsg) {
        liveMsg._progress = 'Stopping...';
        liveMsg.streaming = false;
      }
      currentStream = null;
      localSseActive = false;
      renderList();
    },
    onSubmit: startTeamMobileSend,
  });
  renderQueue();
}

/* ---------------- WORKSPACE TAB ---------------- */

function _fileIcon(name) {
  const n = String(name || '').toLowerCase();
  if (/\.(md|markdown|txt)$/.test(n))    return '📝';
  if (/\.(js|ts|tsx|jsx|mjs|cjs)$/.test(n)) return '📜';
  if (/\.(json|yaml|yml|toml)$/.test(n)) return '🔧';
  if (/\.(png|jpg|jpeg|gif|svg|webp)$/.test(n)) return '🖼️';
  if (/\.(mp4|mov|webm|mkv)$/.test(n))   return '🎬';
  if (/\.(mp3|wav|ogg|flac)$/.test(n))   return '🎵';
  if (/\.(html|htm)$/.test(n))           return '🌐';
  if (/\.(pdf)$/.test(n))                return '📄';
  return '📃';
}

function _formatFileBytes(n) {
  if (!n || n < 1024) return `${n || 0} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function _renderWorkspaceTab(slot, teamId) {
  slot.innerHTML = `<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading workspace…</div>`;
  let ws;
  try { ws = await loadTeamWorkspace(teamId); } catch (err) {
    slot.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.doc}</div><h2>Couldn’t load workspace</h2><p>${escapeHtml(err.message || '')}</p></div>`;
    return;
  }

  const files = ws.files || [];
  if (!files.length) {
    slot.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.doc}</div><h2>Workspace is empty</h2><p>Files written by team subagents will appear here.</p></div>`;
    return;
  }

  slot.innerHTML = `
    <div class="pm-card" style="padding:10px 12px 12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <strong style="font-size:13px;">${files.length} file${files.length === 1 ? '' : 's'}</strong>
        ${ws.workspacePath ? `<span style="font-size:11px;color:var(--pm-muted);font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%;">${escapeHtml(ws.workspacePath)}</span>` : ''}
      </div>
      <div id="pm-ws-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div id="pm-ws-preview" style="margin-top:12px;display:none;"></div>
    </div>
  `;
  const listEl = slot.querySelector('#pm-ws-list');
  const previewEl = slot.querySelector('#pm-ws-preview');

  listEl.innerHTML = files.map(f => {
    const relpath = f.relpath || f.path || f.name || '';
    const size = f.size || 0;
    const updated = f.modifiedAt || f.updatedAt;
    return `
      <button type="button" data-rel="${escapeHtml(relpath)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:12px;padding:10px 12px;cursor:pointer;font-family:inherit;">
        <span style="font-size:18px;">${_fileIcon(relpath)}</span>
        <span style="flex:1;min-width:0;overflow:hidden;">
          <span style="display:block;font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(relpath)}</span>
          <span style="display:block;font-size:11px;color:var(--pm-muted);">${_formatFileBytes(size)}${updated ? ' · ' + _formatTimeAgo(typeof updated === 'number' ? updated : new Date(updated).getTime()) : ''}</span>
        </span>
        <span style="color:var(--pm-muted);">${ICONS.chev}</span>
      </button>
    `;
  }).join('');

  listEl.querySelectorAll('[data-rel]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rel = btn.getAttribute('data-rel');
      previewEl.style.display = 'block';
      previewEl.innerHTML = `<div class="pm-card-body" style="padding:14px;color:var(--pm-muted);">Loading ${escapeHtml(rel)}…</div>`;
      try {
        const r = await loadTeamWorkspaceFile(teamId, rel);
        const text = r?.content || r?.body || '';
        previewEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <strong style="flex:1;font-size:13px;">${escapeHtml(rel)}</strong>
            <button class="pm-btn ghost" id="pm-ws-close" style="padding:4px 10px;font-size:12px;">✕ Close</button>
          </div>
          <pre style="background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:10px;padding:12px;font-size:12px;line-height:1.5;font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;margin:0;">${escapeHtml(String(text).slice(0, 50000))}${String(text).length > 50000 ? '\n\n…(truncated)' : ''}</pre>
        `;
        previewEl.querySelector('#pm-ws-close').addEventListener('click', () => { previewEl.style.display = 'none'; previewEl.innerHTML = ''; });
        previewEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (err) {
        previewEl.innerHTML = `<div class="pm-card-body" style="color:var(--pm-red);">${escapeHtml(err.message || 'Failed to load file')}</div>`;
      }
    });
  });
}

/* ---------------- MEMORY TAB ---------------- */

async function _renderMemoryTab(slot, teamId, team) {
  slot.innerHTML = `<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading memory…</div>`;
  let graph;
  try { graph = await loadMemoryGraph(); } catch (err) {
    slot.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.brain}</div><h2>Couldn’t load memory</h2><p>${escapeHtml(err.message || '')}</p></div>`;
    return;
  }

  let nodes = Array.isArray(graph?.nodes) ? graph.nodes.slice() : [];
  // Prefer entries that look team-relevant: matching projectId, or path containing the team id/name.
  const teamId2 = String(teamId).toLowerCase();
  const teamName = String(team?.name || '').toLowerCase();
  const matchesTeam = (n) => {
    const p = String(n.sourcePath || '').toLowerCase();
    const pj = String(n.projectId || '').toLowerCase();
    return (pj && pj.includes(teamId2)) || (p && (p.includes(teamId2) || (teamName && p.includes(teamName))));
  };
  const teamNodes = nodes.filter(matchesTeam);
  const display = (teamNodes.length ? teamNodes : nodes)
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, 30);

  if (!display.length) {
    slot.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.brain}</div><h2>No memory yet</h2><p>As the team works, reflections and memory entries land here.</p></div>`;
    return;
  }

  slot.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 4px 10px;color:var(--pm-muted);font-size:12px;">
      <span class="pm-pill ${teamNodes.length ? 'orange' : 'gray'}">${teamNodes.length ? 'team-scoped' : 'global feed'}</span>
      <span>${display.length} of ${nodes.length} entries</span>
    </div>
    ${display.map(n => `
      <article class="pm-card" style="padding:12px 14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <strong style="flex:1;font-size:13px;line-height:1.3;">${escapeHtml(n.label || 'Memory')}</strong>
          <span class="pm-pill gray" style="font-family:ui-monospace,monospace;">${escapeHtml(n.sourceTypeLabel || n.sourceType || 'memory')}</span>
        </div>
        ${n.summary ? `<div class="pm-card-body" style="margin-bottom:4px;">${escapeHtml(String(n.summary).slice(0, 240))}${String(n.summary).length > 240 ? '…' : ''}</div>` : ''}
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--pm-muted);">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;font-family:ui-monospace,monospace;">${escapeHtml(n.sourcePath || '')}</span>
          <span>${n.timestamp ? _formatTimeAgo(new Date(n.timestamp).getTime()) : ''}</span>
        </div>
      </article>
    `).join('')}
  `;
}

export {
  _formatDuration,
  _installMobileAgentComposer,
  _mobileReplayFrameToEvent,
  _renderMobileAgentChatList,
  _renderMobileAgentComposerHtml,
};
