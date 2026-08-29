// Subagents route owner. Loaded only when its route or a shared dependent feature is requested.
import {
  ICONS,
  __pmChat,
  __pmVoice,
  _applyMobileAgentStreamEvent,
  _approvalFromMobileEvent,
  _buildMobileFileContextNote,
  _closeMobileQueuedPromptMenus,
  _closeMobileSources,
  _copyMobileSnippetText,
  _deliverSubagentVoiceReplyOnce,
  _drawAgentSVG,
  _ensureMobileQueuedPromptMenuDismiss,
  _formatTimeAgo,
  _installMobileTimestampReveal,
  _loadMobileSources,
  _mobileSubagentHeaderLabel,
  _mobileSubagentModelParts,
  _mobileVoiceTargetPayload,
  _normalizeMobileApproval,
  _normalizeVoiceEchoText,
  _openMobileSources,
  _pmRenderTaskJournal,
  _renderAgentModelPicker,
  _renderAgentVoicePicker,
  _renderMobileAgentChatBubble,
  _renderMobileGoalPill,
  _renderMobileMarkdown,
  _wireMobileApprovalActionButton,
  _uploadMobileChatAttachments,
  _voiceDebug,
  _wireMobileProcessRunActions,
  agentModelPickerHydrate,
  agentVoicePickerHydrate,
  attachMobileButtonHaptic,
  detachMobileResource,
  escapeHtml,
  getCachedMobilePageData,
  loadMobileApprovals,
  loadMobileSubagentDetail,
  loadMobileSubagents,
  loadSubagentChat,
  loadSubagentChatStreamReplay,
  loadSubagentContextRefs,
  loadSubagentHeartbeat,
  loadSubagentMemory,
  loadSubagentRunDetail,
  loadSubagentRuns,
  loadSubagentSystemPrompt,
  pmToast,
  registerAgentModelPickerOnSaved,
  registerAgentVoicePickerOnSaved,
  renderMobileContextChip,
  renderMobileHeader,
  sendSubagentRunRecovery,
  setMobileSubagentReasoningContext,
  spawnSubagentTask,
  streamSubagentChat,
  subagentChatSessionId,
  tickSubagentHeartbeat,
  wireHeaderActions,
  wireMobileContextWindow,
  wsEventBus,
} from './mobile-pages.js';

import {
  _formatDuration,
  _installMobileAgentComposer,
  _mobileReplayFrameToEvent,
  _renderMobileAgentChatList,
  _renderMobileAgentComposerHtml,
} from './mobile-teams-pages.js';

import {
  _pmRenderTaskProgress,
  _pmRenderTaskPromptDisclosure,
  _pmTaskPill,
  _pmTaskProgressItems,
} from './mobile-tasks-pages.js';

/* ---------------- SUBAGENTS ---------------- */

// Avatar palette + hash match desktop SubagentsPage so the same agent gets the
// same robot + color across desktop and mobile.






// Procedurally-generated cute robot. Ported from drawAgentSVG in
// web-ui/src/pages/SubagentsPage.js so desktop and mobile show the same robot.


const SUBAGENT_STATUS_PILL = {
  running:   { label: 'running',   cls: 'running' },
  idle:      { label: 'idle',      cls: 'gray' },
  scheduled: { label: 'scheduled', cls: 'orange' },
  team:      { label: 'team',      cls: 'active' },
  failed:    { label: 'failed',    cls: 'orange' },
};

function _subagentTileHtml(a) {
  const pill = SUBAGENT_STATUS_PILL[a.status] || SUBAGENT_STATUS_PILL.idle;
  return `
    <button class="pm-team-tile pm-subagent-tile" data-subagent="${escapeHtml(a.id)}" type="button">
      <span class="pm-subagent-robot">${_drawAgentSVG(a.id, { scale: 0.5 })}</span>
      <span class="pm-team-tile-meta">
        <strong>${escapeHtml(a.name)}</strong>
        <small>${a.model ? escapeHtml(a.model) : 'default model'}</small>
      </span>
      <span class="pm-pill ${pill.cls}">${pill.label}</span>
    </button>
  `;
}

function subagentsSkeletonHtml() {
  return `
    <div class="pm-team-grid">
      ${Array.from({ length: 4 }).map(() => `
        <div class="pm-team-tile" style="opacity:.5;">
          <span class="pm-avatar" style="background:var(--pm-bg-soft);">…</span>
          <span class="pm-team-tile-meta"><strong style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;">loading</strong><small style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;">model</small></span>
        </div>
      `).join('')}
    </div>
  `;
}

export async function renderSubagentsPage(page, { navigate } = {}) {
  const extras = `
    <span class="pm-count-pill" id="pm-subagents-count">…</span>
    <span class="pm-spacer"></span>
    <button class="pm-icon-btn" id="pm-subagents-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>
  `;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Subagents', online: false, extras })}
    <div class="pm-body" id="pm-subagents-body">${subagentsSkeletonHtml()}</div>
  `;
  wireHeaderActions(page, {});

  const body = page.querySelector('#pm-subagents-body');
  const countEl = page.querySelector('#pm-subagents-count');

  async function paint({ force = false } = {}) {
    let agents = [];
    try {
      agents = await loadMobileSubagents({ force });
    } catch (err) {
      body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.robot}</div><h2>Couldn’t load subagents</h2><p>${escapeHtml(err.message || 'Network error')}</p></div>`;
      countEl.textContent = '0 agents';
      return;
    }
    countEl.textContent = `${agents.length} agent${agents.length === 1 ? '' : 's'}`;
    if (!agents.length) {
      body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.robot}</div><h2>No subagents yet</h2><p>Create agents from the desktop Settings → Agents page.</p></div>`;
      return;
    }
    const featured = agents[0];
    const previewHtml = `
      <div class="pm-team-preview">
        <div class="pm-team-preview-head">
          <span class="pm-subagent-robot pm-subagent-robot-sm">${_drawAgentSVG(featured.id, { scale: 0.45 })}</span>
          <h3>${escapeHtml(featured.name)}</h3>
          <button class="pm-pill-btn" data-go="${escapeHtml(featured.id)}">Open ${ICONS.chev}</button>
        </div>
        <div style="font-size:13px;color:var(--pm-muted);font-weight:700;margin-top:4px;">${escapeHtml(featured.model || 'Default model')}${featured.isTeamMember ? ' · team member' : ''}</div>
        ${featured.description ? `<div class="pm-card-body" style="margin-top:6px;">${escapeHtml(featured.description.slice(0, 240))}${featured.description.length > 240 ? '…' : ''}</div>` : ''}
        <div class="pm-divider"></div>
        <div class="pm-row"><span>${ICONS.wand} Tools</span><span style="color:var(--pm-muted)">${featured.tools.length ? featured.tools.length + ' allowed' : 'all'}</span></div>
        <div class="pm-divider"></div>
        <div class="pm-row"><span>${ICONS.clock} Last run</span><span style="color:var(--pm-muted)">${escapeHtml(_formatTimeAgo(featured.lastRunAt || 0))}</span></div>
      </div>
    `;
    body.innerHTML = `
      <div class="pm-team-grid">${agents.map(_subagentTileHtml).join('')}</div>
      ${previewHtml}
    `;
    body.querySelectorAll('[data-subagent]').forEach(btn => {
      btn.addEventListener('click', () => navigate?.(`#mobile/subagents/${btn.getAttribute('data-subagent')}`));
    });
    body.querySelectorAll('[data-go]').forEach(btn => {
      btn.addEventListener('click', () => navigate?.(`#mobile/subagents/${btn.getAttribute('data-go')}`));
    });
  }

  page.querySelector('#pm-subagents-refresh').addEventListener('click', () => {
    body.innerHTML = subagentsSkeletonHtml();
    paint({ force: true });
  });
  const cachedSubagents = getCachedMobilePageData('subagents', 21_600_000);
  await paint();
  if (Array.isArray(cachedSubagents)) paint({ force: true }).catch(() => {});
}





/* ---------------- SUBAGENT DETAIL ---------------- */

function subagentDetailSkeleton() {
  return `
    <div class="pm-detail-head"><span class="pm-subagent-robot pm-subagent-robot-lg" style="opacity:.4;">${_drawAgentSVG('loading', { scale: 0.7 })}</span><h1 style="background:rgba(0,0,0,.06);color:transparent;border-radius:8px;height:24px;flex:1;">loading</h1></div>
    <div class="pm-detail-sub">…</div>
    <div class="pm-action-row">
      <button class="pm-action-btn primary">${ICONS.send} Dispatch</button>
      <button class="pm-action-btn">${ICONS.refresh} Heartbeat</button>
    </div>
    <div class="pm-card" style="opacity:.5"><div class="pm-card-head">${ICONS.robot} Overview</div><div class="pm-card-body">Loading agent…</div></div>
  `;
}

export async function renderSubagentDetailPage(page, { agentId, navigate, initialTab = '' }) {
  page.innerHTML = `
    <header class="pm-header">
      <button class="pm-icon-btn" data-action="back" aria-label="Back">${ICONS.back}</button>
            <div class="pm-header-actions">
        <button class="pm-icon-btn" data-action="settings" aria-label="Settings">${ICONS.gear}</button>
      </div>
    </header>
    <div class="pm-body pm-subagent-detail-body" id="pm-detail-body">${subagentDetailSkeleton()}</div>
  `;
  wireHeaderActions(page, { onBack: () => navigate?.('#mobile/subagents') });

  const body = page.querySelector('#pm-detail-body');

  let agent = null;
  try {
    agent = await loadMobileSubagentDetail(agentId);
  } catch (err) {
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.robot}</div><h2>Couldn’t load subagent</h2><p>${escapeHtml(err.message || 'Network error')}</p></div>`;
    return;
  }
  if (!agent) {
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.robot}</div><h2>Subagent not found</h2><p>${escapeHtml(agentId)} isn’t available right now.</p></div>`;
    return;
  }

  const pill = SUBAGENT_STATUS_PILL[agent.status] || SUBAGENT_STATUS_PILL.idle;
  const tabs = ['Overview', 'Chat', 'Memory', 'Runs', 'Heartbeat'];
  const modelPickerScope = `pm-sa-model-${agent.id}`;
  const voicePickerScope = `pm-sa-voice-${agent.id}`;
  const displayModel = String(agent.effectiveModel || agent.model || '').trim();

  body.innerHTML = `
    <div class="pm-detail-head">
      <span class="pm-subagent-robot pm-subagent-robot-lg">${_drawAgentSVG(agent.id, { isActive: true, scale: 0.7 })}</span>
      <h1>${escapeHtml(agent.name)}</h1>
      <span class="pm-pill ${pill.cls}" style="align-self:center;">${pill.label}</span>
    </div>
    <div class="pm-detail-sub">${escapeHtml(displayModel ? displayModel.split('/').pop() : 'Default model')}${agent.isTeamMember ? ' · team member' : ''}${agent.cronSchedule ? ' · scheduled' : ''}</div>

    <div class="pm-action-row">
      <button class="pm-action-btn primary" data-act="dispatch">${ICONS.send} Dispatch Task</button>
      <button class="pm-action-btn"          data-act="heartbeat">${ICONS.refresh} Tick</button>
      <button class="pm-action-btn"          data-act="open-chat">${ICONS.chat} Chat</button>
    </div>

    <div class="pm-tabs" role="tablist">
      ${tabs.map((tab, i) => `<button class="${i === 0 ? 'active' : ''}" data-tab="${tab}">${escapeHtml(tab)}</button>`).join('')}
    </div>

    <div id="pm-tab-slot"></div>

    <div id="pm-overview-slot">
      <div class="pm-card">
        <div class="pm-card-head">${ICONS.target} Description</div>
        <div class="pm-card-body">${escapeHtml(agent.description || 'No description set.')}</div>
      </div>

      <div class="pm-card-grid">
        <div class="pm-card">
          <div class="pm-card-head">${ICONS.brain} Model</div>
          <div class="pm-card-body strong">${escapeHtml(displayModel ? displayModel.split('/').pop() : 'default')}</div>
        </div>
        <div class="pm-card">
          <div class="pm-card-head">${ICONS.clock} Last Run</div>
          <div class="pm-card-body strong">${escapeHtml(_formatTimeAgo(agent.lastRunAt || 0))}</div>
        </div>
        <div class="pm-card">
          <div class="pm-card-head">${ICONS.wand} Allowed Tools</div>
          <div class="pm-card-body">${agent.tools.length ? agent.tools.slice(0, 8).map(t => `<span class="pm-tool-chip">${escapeHtml(String(t))}</span>`).join(' ') + (agent.tools.length > 8 ? `<span class="pm-tool-chip more">+${agent.tools.length - 8}</span>` : '') : '<em style="color:var(--pm-muted);">All tools</em>'}</div>
        </div>
        <div class="pm-card">
          <div class="pm-card-head">${ICONS.globe} MCP Servers</div>
          <div class="pm-card-body">${agent.mcpServers.length ? agent.mcpServers.map(s => `<span class="pm-tool-chip">${escapeHtml(String(s))}</span>`).join(' ') : '<em style="color:var(--pm-muted);">None</em>'}</div>
        </div>
      </div>

      ${_renderAgentModelPicker(agent, modelPickerScope)}
      ${_renderAgentVoicePicker(agent, voicePickerScope)}

      <div class="pm-card" id="pm-subagent-ctxrefs">
        <div class="pm-card-head">${ICONS.doc} Context References</div>
        <div class="pm-card-body" id="pm-subagent-ctxrefs-body">Loading…</div>
      </div>
    </div>
  `;

  // Lazy-load context refs into overview.
  (async () => {
    try {
      const refs = await loadSubagentContextRefs(agentId);
      const host = body.querySelector('#pm-subagent-ctxrefs-body');
      if (!host) return;
      if (!refs.length) {
        host.innerHTML = '<em style="color:var(--pm-muted);">No context references attached.</em>';
        return;
      }
      host.innerHTML = refs.slice(0, 10).map(r => `
        <div class="pm-ctxref">
          <strong>${escapeHtml(r.title || r.id || 'Reference')}</strong>
          <span>${escapeHtml(String(r.body || r.content || r.preview || '').slice(0, 140))}${String(r.body || r.content || r.preview || '').length > 140 ? '…' : ''}</span>
        </div>
      `).join('');
    } catch {}
  })();

  const overviewSlot = body.querySelector('#pm-overview-slot');
  const tabSlot = body.querySelector('#pm-tab-slot');

  let currentStream = null;
  const refreshOverview = () => renderSubagentDetailPage(page, { agentId, navigate, initialTab: 'overview' });
  registerAgentModelPickerOnSaved(modelPickerScope, refreshOverview);
  registerAgentVoicePickerOnSaved(voicePickerScope, refreshOverview);
  agentModelPickerHydrate(modelPickerScope, agent);
  agentVoicePickerHydrate(voicePickerScope, agent);

  async function selectTab(tabName) {
    try { tabSlot?._pmCleanup?.(); } catch {}
    if (tabSlot) tabSlot._pmCleanup = null;
    body.querySelectorAll('.pm-tabs button').forEach(x => x.classList.toggle('active', x.getAttribute('data-tab') === tabName));
    if (tabName === 'Overview') {
      overviewSlot.style.display = '';
      tabSlot.innerHTML = '';
      return;
    }
    overviewSlot.style.display = 'none';
    tabSlot.innerHTML = `<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading ${escapeHtml(tabName)}…</div>`;
    try {
      if (tabName === 'Chat') {
        navigate?.(`#mobile/subagents/${encodeURIComponent(agentId)}/chat`);
        return;
      }
      if (tabName === 'Memory') await _renderSubagentMemoryTab(tabSlot, agentId);
      else if (tabName === 'Runs')          await _renderSubagentRunsTab(tabSlot, agentId);
      else if (tabName === 'Heartbeat')     await _renderSubagentHeartbeatTab(tabSlot, agentId);
    } catch (err) {
      tabSlot.innerHTML = `<div class="pm-card"><div class="pm-card-head">${ICONS.robot} Error</div><div class="pm-card-body">${escapeHtml(err.message || 'Failed to load')}</div></div>`;
    }
  }

  body.querySelectorAll('.pm-tabs button').forEach(b => {
    b.addEventListener('click', () => selectTab(b.getAttribute('data-tab')));
  });
  const initialTabName = tabs.find(tab => tab.toLowerCase().replace(/\s+/g, '-') === String(initialTab || '').toLowerCase());
  if (initialTabName && initialTabName !== 'Overview') selectTab(initialTabName);

  // Action buttons.
  async function _action(btn, fn, doneMsg) {
    const prev = btn.innerHTML;
    btn.disabled = true;
    btn.style.opacity = '0.6';
    try {
      const r = await fn();
      if (r && r.success === false) throw new Error(r?.error || 'Failed');
      if (doneMsg) pmToast(doneMsg, 'success');
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
      if (act === 'dispatch') openDispatchSheet(agentId, btn);
      else if (act === 'heartbeat') {
        await _action(btn, () => tickSubagentHeartbeat(agentId), 'Heartbeat ticked').catch(() => {});
      }
      else if (act === 'open-chat') navigate?.(`#mobile/subagents/${encodeURIComponent(agentId)}/chat`);
    });
  });

  page._pmCleanup = () => {
    try { tabSlot?._pmCleanup?.(); } catch {}
    try { currentStream?.abort?.(); } catch {}
  };
}

// Chat is deliberately a locked route, not a detail-tab render. This keeps the
// normal mobile header and the composer/scroll contract intact while a turn is
// streaming, and prevents overview chrome from competing for vertical space.
export async function renderSubagentChatPage(page, { agentId, navigate }) {
  // This route owns a nested message scroller. Ordinary mobile pages use the
  // document scroller, so opt out before the async history renders.
  document.body.classList.add('pm-mobile-subagent-chat-locked');
  setMobileSubagentReasoningContext(null);
  const sessionId = subagentChatSessionId(agentId);
  let agentRef = null;
  const header = renderMobileHeader({
    title: 'Subagent',
    online: true,
    leftIcon: 'back',
    hideTitle: true,
    hideBrand: true,
    rightActions: `<button type="button" class="pm-icon-btn" id="pm-subagent-sources-button" aria-label="Sources">${ICONS.layers}</button>`,
  });
  page.innerHTML = `
    ${header}
    ${renderMobileContextChip()}
    <div class="pm-body pm-subagent-chat-body" id="pm-subagent-chat-body"><div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading chat…</div></div>
    <div id="pm-mobile-sources-popover" class="pm-mobile-sources-popover" hidden role="dialog" aria-modal="true" aria-label="Subagent chat sources">
      <button type="button" id="pm-mobile-sources-scrim" class="pm-mobile-sources-popover-scrim" aria-label="Close Sources"></button>
      <section class="pm-mobile-sources-panel">
        <div class="pm-mobile-sources-header"><div><strong>Sources <span id="pm-mobile-sources-count"></span></strong><div id="pm-mobile-sources-mode">Subagent chat sources</div></div><button type="button" id="pm-mobile-sources-close" class="pm-mobile-sources-close" aria-label="Close Sources">×</button></div>
        <div id="pm-mobile-sources-list" class="pm-mobile-sources-list"><div class="pm-mobile-sources-empty">Sources produced by this subagent appear here.</div></div>
      </section>
    </div>
  `;
  // Seed the shared model-badge slot with Name/Model Effort for this subagent.
  // Main chat keeps using refreshMobileModelBadge; subagent chat owns this label.
  const badgeLabel = page.querySelector('.pm-model-badge .pm-model-badge-label');
  if (badgeLabel) badgeLabel.textContent = 'Loading…';
  const badgeBtn = page.querySelector('.pm-model-badge');
  if (badgeBtn) {
    badgeBtn.classList.add('pm-subagent-model-badge');
    badgeBtn.setAttribute('aria-label', 'Subagent model');
    badgeBtn.title = 'Subagent model';
  }
  wireHeaderActions(page, { onBack: () => navigate?.(`#mobile/subagents/${encodeURIComponent(agentId)}`) });
  page.querySelector('#pm-subagent-sources-button')?.addEventListener('click', () => {
    _openMobileSources(page, { sessionId });
  });
  page.querySelector('#pm-mobile-sources-close')?.addEventListener('click', () => _closeMobileSources(page));
  page.querySelector('#pm-mobile-sources-scrim')?.addEventListener('click', () => _closeMobileSources(page));
  page.querySelector('#pm-mobile-sources-list')?.addEventListener('click', async (event) => {
    const detachButton = event.target?.closest?.('[data-mobile-source-detach]');
    if (!detachButton) return;
    try {
      await detachMobileResource(sessionId, detachButton.getAttribute('data-mobile-source-detach') || '');
      await _loadMobileSources(page, { sessionId, history: false });
    } catch (error) {
      pmToast(error?.message || 'Source operation failed', 'error');
    }
  });
  wireMobileContextWindow(page, {
    getSessionId: () => sessionId,
    getProvider: () => _mobileSubagentModelParts(agentRef || {}).provider,
    getAccountId: () => _mobileSubagentModelParts(agentRef || {}).accountId,
  });
  const body = page.querySelector('#pm-subagent-chat-body');
  let activeStream = null;
  try {
    const agent = await loadMobileSubagentDetail(agentId);
    if (!agent) throw new Error('Subagent not found');
    agentRef = agent;
    const label = _mobileSubagentHeaderLabel(agent);
    if (badgeLabel) badgeLabel.textContent = label;
    if (badgeBtn) {
      badgeBtn.title = label;
      badgeBtn.setAttribute('aria-label', `${label} — tap to choose reasoning level`);
    }
    const modelParts = _mobileSubagentModelParts(agent);
    setMobileSubagentReasoningContext({
      agentId: agent.id,
      provider: modelParts.provider,
      model: modelParts.model,
      effort: modelParts.effort,
      onSaved: ({ effort, agent: savedAgent } = {}) => {
        if (savedAgent && typeof savedAgent === 'object') {
          agentRef = { ...agentRef, ...savedAgent, raw: { ...(agentRef?.raw || {}), ...savedAgent } };
        } else if (agentRef) {
          agentRef = {
            ...agentRef,
            reasoningEffort: String(effort || ''),
            reasoning_effort: String(effort || ''),
            raw: { ...(agentRef.raw || {}), reasoning_effort: String(effort || '') },
          };
        }
        const nextLabel = _mobileSubagentHeaderLabel(agentRef || agent);
        if (badgeLabel) badgeLabel.textContent = nextLabel;
        if (badgeBtn) {
          badgeBtn.title = nextLabel;
          badgeBtn.setAttribute('aria-label', `${nextLabel} — tap to choose reasoning level`);
        }
      },
    });
    // Re-scope plan usage now that we know the agent provider/account.
    window.__pmMobileRefreshContextWindow?.({
      sessionId,
      provider: _mobileSubagentModelParts(agent).provider,
      accountId: _mobileSubagentModelParts(agent).accountId,
    });
    await _renderSubagentChatTab(body, agent, (stream) => { activeStream = stream; });
  } catch (err) {
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.robot}</div><h2>Couldn’t load subagent chat</h2><p>${escapeHtml(err?.message || 'Network error')}</p></div>`;
  }
  page._pmCleanup = () => {
    try { body?._pmCleanup?.(); } catch {}
    try { activeStream?.abort?.(); } catch {}
    setMobileSubagentReasoningContext(null);
    document.body.classList.remove('pm-mobile-subagent-chat-locked');
  };
}



function openDispatchSheet(agentId, anchorBtn) {
  const overlay = document.createElement('div');
  overlay.className = 'pm-creative-sheet-overlay';
  overlay.innerHTML = `
    <div class="pm-creative-sheet">
      <h3>Dispatch a task</h3>
      <p style="color:var(--pm-muted);font-size:13px;margin:-6px 0 12px;text-align:center;">Sent to <strong>${escapeHtml(agentId)}</strong> as a one-shot task.</p>
      <textarea class="pm-textarea" id="pm-dispatch-task" rows="4" placeholder="Describe the task for this subagent…" style="min-height:120px;"></textarea>
      <div class="pm-row-buttons" style="margin-top:10px;">
        <button class="pm-btn ghost" data-close="1">Cancel</button>
        <button class="pm-btn primary" id="pm-dispatch-submit">${ICONS.send} Dispatch</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.getAttribute('data-close')) close();
  });
  overlay.querySelector('#pm-dispatch-submit').addEventListener('click', async () => {
    const task = String(overlay.querySelector('#pm-dispatch-task').value || '').trim();
    if (!task) { pmToast('Describe the task first', 'error'); return; }
    const submit = overlay.querySelector('#pm-dispatch-submit');
    submit.disabled = true;
    submit.innerHTML = '…sending';
    try {
      const r = await spawnSubagentTask(agentId, task);
      if (r?.success) {
        const preview = String(r.result?.result || r.result?.summary || '').slice(0, 140);
        pmToast(preview ? `Done · ${preview}` : 'Task complete', 'success');
        close();
      } else {
        pmToast(r?.error || 'Dispatch failed', 'error');
        submit.disabled = false;
        submit.innerHTML = `${ICONS.send} Dispatch`;
      }
    } catch (err) {
      pmToast(err.message || 'Dispatch failed', 'error');
      submit.disabled = false;
      submit.innerHTML = `${ICONS.send} Dispatch`;
    }
  });
  setTimeout(() => overlay.querySelector('#pm-dispatch-task')?.focus(), 50);
}

async function _renderSubagentMemoryTab(slot, agentId) {
  const [agentMd, memory] = await Promise.all([loadSubagentSystemPrompt(agentId), loadSubagentMemory(agentId)]);
  const files = [
    { key: 'agent', title: 'AGENT.md', content: agentMd, exists: !!agentMd, empty: 'No AGENT.md is set for this agent yet.' },
    { key: 'memory', title: 'MEMORY.md', content: memory.content, exists: memory.exists, empty: 'No personal memory file exists for this agent yet.' },
  ];
  let openKey = '';
  const render = () => {
    slot.innerHTML = `<section class="pm-subagent-memory" aria-label="Subagent memory files">
      <p class="pm-subagent-memory-intro">Private, read-only context for this agent.</p>
      ${files.map((file) => {
        const open = openKey === file.key;
        return `<article class="pm-subagent-memory-item ${open ? 'open' : ''}">
          <button type="button" class="pm-subagent-memory-toggle" data-memory-file="${file.key}" aria-expanded="${open}">
            <span>${ICONS.doc}<strong>${file.title}</strong></span><span class="pm-subagent-memory-chevron">⌄</span>
          </button>
          ${open ? `<div class="pm-subagent-memory-panel">
            <div class="pm-subagent-memory-actions"><span>${file.exists ? 'Read-only' : 'Not found'}</span>${file.content ? `<button type="button" class="pm-btn ghost" data-memory-copy="${file.key}">${ICONS.check} Copy</button>` : ''}</div>
            ${file.content ? `<pre class="pm-subagent-md">${escapeHtml(file.content)}</pre>` : `<div class="pm-subagent-memory-empty">${escapeHtml(file.empty)}</div>`}
          </div>` : ''}
        </article>`;
      }).join('')}
    </section>`;
    slot.querySelectorAll('[data-memory-file]').forEach((button) => button.addEventListener('click', () => {
      const key = button.getAttribute('data-memory-file') || '';
      openKey = openKey === key ? '' : key;
      render();
    }));
    slot.querySelectorAll('[data-memory-copy]').forEach((button) => button.addEventListener('click', () => {
      const file = files.find((item) => item.key === button.getAttribute('data-memory-copy'));
      _copyMobileSnippetText(file?.content || '', button);
    }));
  };
  render();
}

function _mobileRunPresentationTitle(value) {
  return String(value || 'Task')
    .replace(/^\s*\[\s*(?:subagent|agent)\s*\]\s*/i, '')
    .trim() || 'Task';
}

function _mobileRunArtifactPresentation(value) {
  const source = String(value || '');
  const file = source.match(/\*\*Ready artifact\*\*\s*[-:]\s*`([^`\n]+)`/i);
  const hash = source.match(/\bSHA-?256:\s*`?([a-f0-9]{32,})`?/i);
  if (!file || !hash) return null;
  const size = source.match(/\bSize:\s*\*{0,2}([\d,.]+\s*(?:bytes?|kb|mb|gb))\*{0,2}/i);
  const lineEnd = source.indexOf('\n', hash.index + hash[0].length);
  const raw = source.slice(file.index, lineEnd === -1 ? source.length : lineEnd);
  return {
    raw,
    path: String(file[1] || '').trim(),
    sha256: String(hash[1] || '').trim(),
    size: String(size?.[1] || '').trim(),
  };
}

function _mobileRunSummaryPresentation(value, { compact = false } = {}) {
  const source = String(value || '').trim();
  if (!source) return '';
  const artifact = _mobileRunArtifactPresentation(source);
  const prose = artifact ? source.replace(artifact.raw, '').trim() : source;
  const visibleProse = compact && prose.length > 420 ? `${prose.slice(0, 417).trimEnd()}...` : prose;
  const proseHtml = visibleProse
    ? `<div class="pm-sa-run-summary markdown-body">${_renderMobileMarkdown(visibleProse)}</div>`
    : '';
  if (!artifact) return proseHtml;
  return `${proseHtml}
    <section class="pm-sa-run-artifact" aria-label="Ready artifact">
      <div class="pm-sa-run-artifact-head">
        <span>Ready artifact</span>
        <button type="button" class="pm-sa-run-copy" data-sa-run-copy="${escapeHtml(artifact.path)}">Copy path</button>
      </div>
      <code class="pm-sa-run-artifact-path" title="${escapeHtml(artifact.path)}">${escapeHtml(artifact.path)}</code>
      <div class="pm-sa-run-artifact-meta">
        ${artifact.size ? `<span>${escapeHtml(artifact.size)}</span>` : ''}
        <span>SHA-256</span>
        <code>${escapeHtml(artifact.sha256)}</code>
        <button type="button" class="pm-sa-run-copy" data-sa-run-copy="${escapeHtml(artifact.sha256)}">Copy hash</button>
      </div>
    </section>`;
}

async function _renderSubagentRunsTab(slot, agentId) {
  let runs = await loadSubagentRuns(agentId, 50);
  let expandedId = '';
  const details = {};
  const recoveryComposerStates = new Map();
  const recoveryComposerRefs = new Map();

  const getRecoveryComposerState = (id) => {
    const key = String(id || '').trim();
    if (!recoveryComposerStates.has(key)) {
      recoveryComposerStates.set(key, {
        busy: false,
        queue: [],
        controller: null,
        status: '',
        tone: '',
      });
    }
    return recoveryComposerStates.get(key);
  };

  const updateRecoveryComposerStatus = (id, message = '', tone = '') => {
    const key = String(id || '').trim();
    const state = getRecoveryComposerState(key);
    state.status = String(message || '').trim();
    state.tone = String(tone || '').trim();
    slot.querySelectorAll('[data-sa-run-composer-status]').forEach((statusNode) => {
      if (String(statusNode.getAttribute('data-sa-run-composer-status') || '') !== key) return;
      statusNode.textContent = state.status;
      statusNode.hidden = !state.status;
      if (state.tone) statusNode.dataset.tone = state.tone;
      else delete statusNode.dataset.tone;
    });
  };

  const refreshRecoveryComposer = (id) => {
    recoveryComposerRefs.get(String(id || '').trim())?.update?.();
  };

  const render = () => {
  if (!runs.length) {
    slot.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clock}</div><h2>No runs yet</h2><p>Tap Dispatch Task above to give this agent something to do.</p></div>`;
    return;
  }
    const groups = [
      { key: 'attention', label: 'Needs Attention', statuses: ['needs_assistance', 'awaiting_user_input', 'stalled'] },
      { key: 'paused', label: 'Paused', statuses: ['paused'] },
      { key: 'running', label: 'Running', statuses: ['queued', 'running', 'waiting_subagent'] },
      { key: 'failed', label: 'Failed', statuses: ['failed'] },
      { key: 'complete', label: 'Completed', statuses: ['complete'] },
    ];
    const matched = new Set();
    const sections = groups.map((group) => {
      const items = runs.filter((run) => {
        const hit = group.statuses.includes(String(run.status || run.taskStatus || '').toLowerCase());
        if (hit) matched.add(String(run.id || run.taskId || ''));
        return hit;
      });
      if (!items.length) return '';
      return `<section style="display:flex;flex-direction:column;gap:8px;">
        <div style="font-size:11px;font-weight:800;color:var(--pm-muted);text-transform:uppercase;letter-spacing:.06em;">${escapeHtml(group.label)} (${items.length})</div>
        ${items.map(renderRunCard).join('')}
      </section>`;
    });
    const other = runs.filter((run) => !matched.has(String(run.id || run.taskId || '')));
    if (other.length) sections.push(`<section style="display:flex;flex-direction:column;gap:8px;">
      <div style="font-size:11px;font-weight:800;color:var(--pm-muted);text-transform:uppercase;letter-spacing:.06em;">Other (${other.length})</div>
      ${other.map(renderRunCard).join('')}
    </section>`);
    slot.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div>
          <div style="font-size:13px;font-weight:800;">Runs</div>
          <div style="font-size:12px;color:var(--pm-muted);">Task work and recovery stay here.</div>
        </div>
        <button class="pm-btn ghost" id="pm-sa-runs-refresh" style="padding:6px 10px;font-size:12px;">${ICONS.refresh}</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px;">${sections.join('')}</div>
    `;
    wire();
  };

  const recoveryMessagesForTask = (task) => (Array.isArray(task?.recoveryConversation) ? task.recoveryConversation : [])
    .map((turn, idx) => ({
      id: `recovery_${task?.id || task?.taskId || 'task'}_${idx}`,
      role: turn?.role === 'user' ? 'user' : 'agent',
      content: String(turn?.content || ''),
      body: {
        text: String(turn?.content || ''),
        attachments: Array.isArray(turn?.attachmentPreviews) ? turn.attachmentPreviews : [],
      },
      attachmentPreviews: Array.isArray(turn?.attachmentPreviews) ? turn.attachmentPreviews : [],
      createdAt: Number(turn?.timestamp || Date.now()) || Date.now(),
    }));

  const renderRecoveryThread = (task, id, canRecover) => {
    const messages = recoveryMessagesForTask(task);
    const threadHtml = messages.length
      ? messages.map((message) => _renderMobileAgentChatBubble(message, { sender: 'Recovery' })).join('')
      : `<div style="font-size:12px;color:var(--pm-muted);padding:8px 2px;">No recovery messages yet.</div>`;
    const prefix = `pm-sa-run-${String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const composerState = getRecoveryComposerState(id);
    return `<section class="pm-sa-run-recovery-panel">
      <div class="pm-card-head" style="color:var(--pm-orange);">Recovery Chat</div>
      ${task?.pendingClarificationQuestion ? `<div class="pm-card-body"><strong>Pending question:</strong> ${escapeHtml(String(task.pendingClarificationQuestion))}</div>` : ''}
      ${task?.pauseAnalysis?.message ? `<div class="pm-card-body" style="white-space:pre-wrap;"><strong>Pause analysis:</strong><br>${escapeHtml(String(task.pauseAnalysis.message).slice(0, 1200))}</div>` : ''}
      <div class="pm-sa-run-recovery-thread">${threadHtml}</div>
      ${canRecover ? `<div class="pm-sa-run-recovery-composer" data-sa-run-composer="${escapeHtml(id)}">
        ${_renderMobileAgentComposerHtml(prefix, 'Reply to this run...')}
        <div class="pm-sa-run-composer-status" data-sa-run-composer-status="${escapeHtml(id)}" role="status" aria-live="polite"${composerState.status ? '' : ' hidden'} data-tone="${escapeHtml(composerState.tone)}">${escapeHtml(composerState.status)}</div>
      </div>` : ''}
    </section>`;
  };

  const renderRunCard = (r) => {
    const id = String(r.id || r.taskId || '');
    const status = String(r.status || r.taskStatus || '').toLowerCase();
    const pillMeta = _pmTaskPill(status);
    const summary = String(r.resultPreview || r.finalSummary || r.pauseAnalysis?.message || r.prompt || '').trim();
    const title = _mobileRunPresentationTitle(r.taskName || r.title || 'Task');
    const started = r.startedAt || r.createdAt;
    const finished = r.completedAt || r.finishedAt;
    const duration = (finished && started) ? _formatDuration(finished - started) : '';
    const isOpen = expandedId === id;
    const detail = details[id]?.task;
    const loading = details[id]?.loading;
    const canRecover = !!(detail?.canRecover || r.canRecover || ['needs_assistance', 'awaiting_user_input', 'paused', 'stalled', 'failed'].includes(status));
    return `
      <article class="pm-card pm-sa-run-card" data-sa-run-id="${escapeHtml(id)}" style="padding:14px 16px;cursor:pointer;border-color:${isOpen ? 'var(--pm-orange)' : 'var(--pm-border)'};">
        <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">
          <strong class="pm-sa-run-title">${escapeHtml(title)}</strong>
          <span class="pm-pill ${pillMeta.cls}">${escapeHtml(pillMeta.label)}</span>
        </div>
        ${summary ? `<div class="pm-sa-run-summary-wrap">${_mobileRunSummaryPresentation(summary, { compact: true })}</div>` : ''}
        <div class="pm-sa-run-meta">
          <span>${escapeHtml(r.trigger || r.source || 'manual')} - ${r.completedSteps || 0}/${r.totalSteps || r.stepCount || 0} steps</span>
          <span>${_formatTimeAgo(r.lastProgressAt || started)}${duration ? ' - ' + duration : ''}</span>
        </div>
        ${canRecover && !isOpen ? `<div style="margin-top:8px;font-size:12px;font-weight:800;color:var(--pm-orange);">Open recovery chat</div>` : ''}
        ${isOpen ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--pm-border);display:flex;flex-direction:column;gap:12px;cursor:default;">
          ${loading || !detail ? `<div class="pm-card-body">Loading run details...</div>` : `
            ${detail.finalSummary ? `<section><div class="pm-card-head">Output</div><div class="pm-sa-run-output">${_mobileRunSummaryPresentation(detail.finalSummary)}</div></section>` : ''}
            ${canRecover || detail.recoveryConversation?.length ? renderRecoveryThread(detail, id, canRecover) : ''}
            <section><div class="pm-card-head">Progress</div>${_pmRenderTaskProgress(_pmTaskProgressItems(detail))}</section>
            ${_pmRenderTaskPromptDisclosure(detail)}
            <section><div class="pm-card-head">Process Log</div>${_pmRenderTaskJournal(detail.journal)}</section>
          `}
        </div>` : ''}
      </article>`;
  };

  async function openDetail(id) {
    expandedId = expandedId === id ? '' : id;
    if (expandedId && !details[id]?.task) {
      details[id] = { loading: true };
      render();
      try {
        const data = await loadSubagentRunDetail(agentId, id);
        details[id] = { task: data.task || null, run: data.run || null, evidenceBus: data.evidenceBus || null };
      } catch (err) {
        details[id] = { task: null, error: err?.message || 'Failed to load run' };
        pmToast(err?.message || 'Failed to load run', 'error');
      }
    }
    render();
  }

  function wire() {
    slot.querySelector('#pm-sa-runs-refresh')?.addEventListener('click', async (event) => {
      event.stopPropagation();
      runs = await loadSubagentRuns(agentId, 50);
      render();
    });
    slot.querySelectorAll('[data-sa-run-id]').forEach((card) => {
      card.addEventListener('click', async (event) => {
        if (event.target.closest('button, textarea, input, a, summary')) return;
        await openDetail(card.getAttribute('data-sa-run-id'));
      });
    });
    slot.querySelectorAll('[data-sa-run-copy]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        _copyMobileSnippetText(button.getAttribute('data-sa-run-copy') || '', button);
      });
    });
    slot.querySelectorAll('[data-sa-run-composer]').forEach((host) => {
      const id = String(host.getAttribute('data-sa-run-composer') || '').trim();
      if (!id) return;
      const prefix = `pm-sa-run-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const state = getRecoveryComposerState(id);
      const submitRecoveryPayload = async (payload, { queued = false } = {}) => {
        const rawText = String(payload?.text || '').trim();
        const rawFiles = Array.isArray(payload?.files) ? payload.files : [];
        if (!rawText && !rawFiles.length) return;
        if (state.busy) {
          if (state.queue.length >= 8) {
            updateRecoveryComposerStatus(id, 'Queue is full. Wait for the current reply to finish.', 'error');
            pmToast('Recovery queue is full.', 'error');
            return;
          }
          state.queue.push({ text: rawText, files: rawFiles });
          updateRecoveryComposerStatus(id, `Queued reply ${state.queue.length}/8.`, 'queued');
          pmToast('Recovery reply queued.', 'info');
          refreshRecoveryComposer(id);
          return;
        }

        state.busy = true;
        state.controller = new AbortController();
        state.status = '';
        state.tone = '';
        refreshRecoveryComposer(id);
        updateRecoveryComposerStatus(id, queued ? 'Sending queued reply…' : 'Sending recovery reply…', 'busy');

        let completed = false;
        try {
          let attachmentPreviews = rawFiles;
          if (rawFiles.length) {
            updateRecoveryComposerStatus(id, `Uploading ${rawFiles.length === 1 ? 'attachment' : 'attachments'}…`, 'busy');
            const uploadResults = await _uploadMobileChatAttachments(rawFiles, { signal: state.controller.signal });
            attachmentPreviews = uploadResults.map((r, idx) => ({
              ...(rawFiles[idx] || {}),
              name: r.name || rawFiles[idx]?.name || 'attachment',
              kind: r.isImage ? 'image' : (r.isVideo ? 'video' : (rawFiles[idx]?.kind || 'file')),
              workspacePath: r.workspacePath || rawFiles[idx]?.workspacePath,
              path: r.workspacePath || rawFiles[idx]?.path,
              dataUrl: rawFiles[idx]?.dataUrl,
              mimeType: rawFiles[idx]?.mimeType,
              sizeLabel: rawFiles[idx]?.sizeLabel,
            }));
          }
          const data = await sendSubagentRunRecovery(
            agentId,
            id,
            rawText || (attachmentPreviews.length ? 'Please review the attached file(s).' : ''),
            attachmentPreviews,
            { signal: state.controller.signal },
          );
          if (data?.task) details[id] = { task: data.task, run: data.run || null, evidenceBus: data.evidenceBus || null };
          runs = await loadSubagentRuns(agentId, 50);
          completed = true;
          updateRecoveryComposerStatus(id, data?.resumed ? 'Run resumed.' : 'Reply sent.', 'success');
          pmToast(data?.resumed ? 'Run resumed' : 'Reply sent', 'success');
        } catch (err) {
          const stopped = state.controller?.signal?.aborted || err?.name === 'AbortError';
          if (stopped) {
            updateRecoveryComposerStatus(id, 'Stopped. The run was not changed.', 'stopped');
            pmToast('Recovery reply stopped.', 'info');
          } else {
            const message = err?.message || 'Recovery reply failed.';
            updateRecoveryComposerStatus(id, message, 'error');
            pmToast(message, 'error');
          }
        } finally {
          const next = completed && state.queue.length ? state.queue.shift() : null;
          state.busy = false;
          state.controller = null;
          render();
          if (next) {
            void submitRecoveryPayload(next, { queued: true });
          }
        }
      };
      const composer = _installMobileAgentComposer(host, prefix, {
        placeholder: 'Reply to this run...',
        draftKey: `subagent_run:${agentId}:${id}`,
        isBusy: () => state.busy,
        onAbort: () => {
          if (!state.busy) return;
          state.controller?.abort?.();
          refreshRecoveryComposer(id);
        },
        onSubmit: (payload) => submitRecoveryPayload(payload),
      });
      recoveryComposerRefs.set(id, composer);
    });
  }

  render();
}

async function _renderSubagentHeartbeatTab(slot, agentId) {
  slot.innerHTML = `<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading heartbeat…</div>`;
  const { status, markdown } = await loadSubagentHeartbeat(agentId);
  const lastTick = status?.lastTickAt || status?.last_tick_at || status?.timestamp;
  slot.innerHTML = `
    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>${ICONS.clock} Last tick</span>
        <button class="pm-btn primary" id="pm-hb-tick" style="padding:6px 12px;font-size:12px;">${ICONS.refresh} Tick now</button>
      </div>
      <div class="pm-card-body strong">${lastTick ? escapeHtml(_formatTimeAgo(lastTick)) : '<em style="color:var(--pm-muted);">No heartbeat yet</em>'}</div>
    </div>
    ${markdown ? `
      <div class="pm-card" style="padding:0;overflow:hidden;">
        <div class="pm-card-head" style="padding:12px 14px;border-bottom:1px solid var(--pm-border);">${ICONS.doc} Heartbeat Notes</div>
        <pre class="pm-subagent-md">${escapeHtml(markdown)}</pre>
      </div>
    ` : `<div class="pm-empty" style="padding:24px;"><div class="pm-empty-icon">${ICONS.spark}</div><p>No heartbeat notes yet. Tick to refresh.</p></div>`}
  `;
  const btn = slot.querySelector('#pm-hb-tick');
  if (btn) {
    btn.addEventListener('click', async () => {
      const prev = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '…ticking';
      try {
        const r = await tickSubagentHeartbeat(agentId);
        if (r?.success === false) throw new Error(r?.error || 'Failed');
        pmToast('Heartbeat ticked', 'success');
        await _renderSubagentHeartbeatTab(slot, agentId);
      } catch (err) {
        pmToast(err.message || 'Tick failed', 'error');
        btn.disabled = false;
        btn.innerHTML = prev;
      }
    });
  }
}

async function _renderSubagentChatTab(slot, agent, attachStream) {
  const agentSessionId = subagentChatSessionId(agent.id);
  slot.innerHTML = `
    <div class="pm-sa-chat-shell" id="pm-sa-chat-card">
      <div class="pm-sa-chat-scrollport">
        <div id="pm-sa-chat-list" class="pm-sa-chat-list"></div>
        <div id="pm-sa-chat-queue" class="pm-mobile-queued-prompts" hidden></div>
      </div>
      <div id="pm-sa-chat-goal" class="pm-mobile-goal-strip pm-mobile-goal-strip-inline" hidden></div>
      ${_renderMobileAgentComposerHtml('pm-sa-chat', `Message ${agent.name || 'this subagent'}...`)}
    </div>
  `;

  const listEl = slot.querySelector('#pm-sa-chat-list');
  const scrollportEl = slot.querySelector('.pm-sa-chat-scrollport');
  const queueEl = slot.querySelector('#pm-sa-chat-queue');
  _installMobileTimestampReveal(listEl, () => {});
  const goalEl = slot.querySelector('#pm-sa-chat-goal');
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
  let composerResizeObserver = null;
  let composerLayoutRaf = 0;
  let historyResizeObserver = null;
  let initialBottomPinTimer = 0;
  let pinInitialHistoryToBottom = true;

  const isBusy = () => !!(currentStream || liveMsg?.streaming || localSseActive);
  const approvalBelongsHere = (approvalInput = {}) => {
    const approval = _normalizeMobileApproval(approvalInput);
    const sid = String(approval.sessionId || approval.sourceSessionId || '').trim();
    return !!approval.id && (
      sid === agentSessionId
      || String(approval.agentId || '').trim() === String(agent.id)
    );
  };
  const upsertApprovalCard = (approvalInput = {}) => {
    if (!approvalBelongsHere(approvalInput)) return false;
    const approval = _normalizeMobileApproval(approvalInput);
    const idx = approvalCards.findIndex((item) => String(item?.approvalRequest?.id || '') === approval.id);
    const msg = {
      role: 'agent',
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
             <button type="button" class="pm-mobile-queued-text" data-sa-queue-edit="${idx}">${escapeHtml(String(item.text || 'Attached file(s)').slice(0, 120))}${item.files?.length ? ` <em>+${item.files.length}</em>` : ''}</button>
             <div class="pm-mobile-queued-actions">
               <div class="pm-mobile-queued-menu-wrap">
                 <button type="button" class="pm-mobile-queued-icon pm-mobile-queued-menu-trigger" data-sa-queue-menu="${idx}" aria-label="Queued message actions" title="Actions">${ICONS.dots}</button>
                 <div class="pm-mobile-queued-popover" data-sa-queue-menu-popover="${idx}" hidden>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-steer" data-sa-queue-steer="${idx}">${ICONS.target}<span>Steer</span></button>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-remove" data-sa-queue-remove="${idx}">${ICONS.trash}<span>Delete</span></button>
                 </div>
               </div>
             </div>
           </div>`).join('')}</div>`
      : '';
    _ensureMobileQueuedPromptMenuDismiss();
    queueEl.querySelectorAll('[data-sa-queue-edit]').forEach((btn) => attachMobileButtonHaptic(btn, () => {}));
    queueEl.querySelectorAll('[data-sa-queue-menu]').forEach((btn) => attachMobileButtonHaptic(btn, () => {
      const idx = Number(btn.getAttribute('data-sa-queue-menu'));
      if (!Number.isInteger(idx)) return;
      const menu = queueEl.querySelector(`[data-sa-queue-menu-popover="${idx}"]`);
      if (!menu) return;
      const nextOpen = !!menu.hidden;
      _closeMobileQueuedPromptMenus(queueEl);
      menu.hidden = !nextOpen;
    }));
    queueEl.querySelectorAll('[data-sa-queue-steer]').forEach((btn) => attachMobileButtonHaptic(btn, () => {
      const idx = Number(btn.getAttribute('data-sa-queue-steer'));
      if (Number.isFinite(idx) && idx >= 0 && idx < sendQueue.length) {
        const [item] = sendQueue.splice(idx, 1);
        if (item) sendQueue.unshift(item);
      }
      _closeMobileQueuedPromptMenus(queueEl);
      renderQueue();
      drainQueueSoon();
    }));
    queueEl.querySelectorAll('[data-sa-queue-remove]').forEach((btn) => attachMobileButtonHaptic(btn, () => {
      const idx = Number(btn.getAttribute('data-sa-queue-remove'));
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
    startSubagentMobileSend(next).catch((err) => pmToast(err?.message || 'Send failed', 'error'));
  }

  function normalizeSubagentChatDedupeText(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  function dedupeSubagentChatMessages(items) {
    const out = [];
    const seenIds = new Set();
    const near = new Map();
    (Array.isArray(items) ? items : []).forEach((msg) => {
      if (!msg || typeof msg !== 'object') return;
      const id = String(msg.id || '').trim();
      if (id) {
        if (seenIds.has(id)) return;
        seenIds.add(id);
      }
      const content = normalizeSubagentChatDedupeText(msg.content || msg.text || msg.body?.text || '');
      if (content) {
        const key = `${String(msg.role || '')}:${content}`;
        const ts = Number(msg.ts || msg.createdAt || msg.timestamp || Date.now()) || Date.now();
        const previousTs = Number(near.get(key) || 0);
        if (previousTs && Math.abs(ts - previousTs) < 30000) return;
        near.set(key, ts);
      }
      out.push(msg);
    });
    return out;
  }

  function upsertServerMessages(fresh) {
    const localLive = liveMsg && !liveMsg._done ? liveMsg : null;
    messages = dedupeSubagentChatMessages(fresh);
    if (localLive) {
      const duplicate = messages.some((m) =>
        (String(localLive.id || '').trim() && String(m.id || '').trim() === String(localLive.id || '').trim())
        || (
          String(m.content || m.text || '').trim()
          && String(m.content || m.text || '').trim() === String(localLive.content || '').trim()
        )
      );
      if (!duplicate) messages.push(localLive);
    }
    messages = dedupeSubagentChatMessages(messages);
  }

  function scrollToLatest() {
    const scroller = scrollportEl || listEl;
    if (!scroller) return;
    const pin = () => { scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight); };
    pin();
    requestAnimationFrame(pin);
    setTimeout(pin, 80);
  }

  function renderList() {
    const visibleApprovals = approvalCards.filter((m) => String(m?.approvalRequest?.status || 'pending') === 'pending');
    const rendered = [...messages, ...visibleApprovals];
    if (!rendered.length) {
      listEl.innerHTML = `<div style="text-align:center;color:var(--pm-muted);padding:24px 8px;font-size:13px;">No messages yet. Send the first one to ${escapeHtml(agent.name)}.</div>`;
      scrollToLatest();
      return;
    }
    _renderMobileAgentChatList(listEl, rendered, (m) => _renderMobileAgentChatBubble(m, {
      sender: agent.name || agent.id || 'Subagent',
      live: m === liveMsg,
      keepLiveTraceVisible: m === liveMsg,
    }));
    listEl.querySelectorAll('[data-pm-approval-action][data-pm-approval-id]').forEach(_wireMobileApprovalActionButton);
    _wireMobileProcessRunActions(listEl);
    scrollToLatest();
  }

  // This route can paint before marked/DOMPurify finish loading on a cold
  // mobile launch. Re-render its own history when they are ready instead of
  // leaving the safe plain-text fallback on screen.
  const onMarkdownReady = () => {
    if (!cleanupDone) renderList();
  };
  window.addEventListener('prometheus:markdown-ready', onMarkdownReady);

  try {
    upsertServerMessages(await loadSubagentChat(agent.id, 80));
    await restoreApprovalCards();
    renderList();
  } catch (err) {
    listEl.innerHTML = `<div style="color:var(--pm-red);padding:16px;">${escapeHtml(err.message || 'Failed to load chat')}</div>`;
  }

  async function reconcile({ forceHistory = false } = {}) {
    try {
      const replay = await loadSubagentChatStreamReplay(agent.id, lastStreamId ? lastSeq : 0);
      if (replay.stream?.streamId && replay.stream.streamId !== lastStreamId) {
        lastStreamId = replay.stream.streamId;
        lastSeq = 0;
      }
      if (replay.stream?.streamId && !liveMsg && replay.active) {
        liveMsg = { role: 'agent', content: '', _progress: 'Reconnecting...', createdAt: Date.now(), workStartedAt: Date.now(), streaming: true, processEntries: [] };
        messages.push(liveMsg);
      }
      for (const frame of replay.events || []) {
        if (frame.streamId) lastStreamId = frame.streamId;
        lastSeq = Math.max(lastSeq, Number(frame.seq || 0));
        if (!liveMsg) {
          liveMsg = { role: 'agent', content: '', _progress: 'Reconnecting...', createdAt: Date.now(), workStartedAt: Date.now(), streaming: true, processEntries: [] };
          messages.push(liveMsg);
        }
        _applyMobileAgentStreamEvent(liveMsg, _mobileReplayFrameToEvent(frame), agent.name || agent.id || 'Subagent');
      }
      if (forceHistory || !replay.active || liveMsg?._done) {
        upsertServerMessages(await loadSubagentChat(agent.id, 80));
        await restoreApprovalCards();
        if (!replay.active) liveMsg = null;
      }
      renderList();
    } catch {}
  }

  const onWsOpen = () => reconcile({ forceHistory: true });
  const onVisibility = () => { if (!document.hidden) reconcile({ forceHistory: true }); };
  const onSubagentChatMessage = async (msg = {}) => {
    if (String(msg.agentId || '') !== String(agent.id)) return;
    try {
      upsertServerMessages(await loadSubagentChat(agent.id, 80));
      // The completed/history broadcast is sent before the stream's terminal
      // frame. Keep the SSE-owned live bubble until that stream has settled;
      // otherwise a WS notification can erase the bubble while tokens are
      // still arriving and leave the callbacks writing into a detached object.
      if (!localSseActive) liveMsg = null;
      renderList();
    } catch {}
  };
  const onSubagentStreamEvent = (msg = {}) => {
    if (String(msg.agentId || '') !== String(agent.id)) return;
    if (localSseActive) return;
    if (msg.streamId && msg.streamId !== lastStreamId) {
      lastStreamId = msg.streamId;
      lastSeq = 0;
    }
    lastSeq = Math.max(lastSeq, Number(msg.seq || 0));
    if (!liveMsg) {
      liveMsg = { role: 'agent', content: '', _progress: `${agent.name} is thinking...`, createdAt: Date.now(), workStartedAt: Date.now(), streaming: true, processEntries: [] };
      messages.push(liveMsg);
    }
    _applyMobileAgentStreamEvent(liveMsg, { type: String(msg.event || ''), ...(msg.data || {}) }, agent.name || agent.id || 'Subagent');
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
  const onSubagentVoiceSubmit = (event) => {
    const detail = event?.detail || {};
    if (detail.accepted === true) return;
    if (String(detail.agentId || '') !== String(agent.id || '')) return;
    const text = String(detail.text || '').trim();
    if (!text) return;
    const voiceSubmitKey = `${agent.id}:${_normalizeVoiceEchoText(text)}`;
    const lastVoiceSubmit = __pmVoice.lastSubagentBridgeSubmit || {};
    if (lastVoiceSubmit.key === voiceSubmitKey && Date.now() - Number(lastVoiceSubmit.at || 0) < 10000) {
      detail.accepted = true;
      detail.promise = Promise.resolve();
      _voiceDebug('subagent-voice-bridge-dedupe-ignored', { agentId: agent.id, textLen: text.length });
      return;
    }
    __pmVoice.lastSubagentBridgeSubmit = { key: voiceSubmitKey, at: Date.now() };
    detail.accepted = true;
    detail.promise = startSubagentMobileSend({
      text,
      runtimeMessage: String(detail.runtimeMessage || text).trim(),
      files: [],
      source: 'subagent_voice',
      speak: true,
    });
  };
  wsEventBus?.on?.('ws:open', onWsOpen);
  wsEventBus?.on?.('subagent_chat_message', onSubagentChatMessage);
  wsEventBus?.on?.('subagent_chat_stream_event', onSubagentStreamEvent);
  wsEventBus?.on?.('approval_created', onApprovalCreated);
  wsEventBus?.on?.('approval_approved', onApprovalApproved);
  wsEventBus?.on?.('approval_denied', onApprovalDenied);
  wsEventBus?.on?.('approval_expired', onApprovalExpired);
  wsEventBus?.on?.('approval_failed', onApprovalFailed);
  window.addEventListener('pm-subagent-voice-submit', onSubagentVoiceSubmit);
  document.addEventListener('visibilitychange', onVisibility);
  slot._pmCleanup = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    try { currentStream?.abort?.(); } catch {}
    if (composerLayoutRaf) cancelAnimationFrame(composerLayoutRaf);
    try { composerResizeObserver?.disconnect?.(); } catch {}
    if (initialBottomPinTimer) clearTimeout(initialBottomPinTimer);
    try { historyResizeObserver?.disconnect?.(); } catch {}
    wsEventBus?.off?.('ws:open', onWsOpen);
    wsEventBus?.off?.('subagent_chat_message', onSubagentChatMessage);
    wsEventBus?.off?.('subagent_chat_stream_event', onSubagentStreamEvent);
    wsEventBus?.off?.('approval_created', onApprovalCreated);
    wsEventBus?.off?.('approval_approved', onApprovalApproved);
    wsEventBus?.off?.('approval_denied', onApprovalDenied);
    wsEventBus?.off?.('approval_expired', onApprovalExpired);
    wsEventBus?.off?.('approval_failed', onApprovalFailed);
    window.removeEventListener('pm-subagent-voice-submit', onSubagentVoiceSubmit);
    window.removeEventListener('prometheus:markdown-ready', onMarkdownReady);
    document.removeEventListener('visibilitychange', onVisibility);
  };
  reconcile();

  async function startSubagentMobileSend(payload) {
    const rawText = String(payload?.text || '').trim();
    const rawRuntimeText = String(payload?.runtimeMessage || payload?.runtime_message || '').trim();
    const files = Array.isArray(payload?.files) ? payload.files : [];
    const source = String(payload?.source || '').trim();
    const isVoiceTurn = source === 'subagent_voice' || payload?.voice === true;
    const userVisibleText = rawText || (files.length ? 'Please review the attached file(s).' : '');
    if (!userVisibleText && !files.length) return;
    if (isBusy()) {
      sendQueue.push({
        text: rawText,
        runtimeMessage: rawRuntimeText,
        files,
        source,
        speak: payload?.speak === true,
        voice: payload?.voice === true,
      });
      renderQueue();
      composer?.update?.();
      return;
    }
    let messageForRuntime = rawRuntimeText || userVisibleText;
    const clientMessageId = payload?.clientMessageId
      || payload?.client_message_id
      || `sa_${String(agent.id || 'agent').replace(/[^a-zA-Z0-9_.:-]/g, '_')}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

    const userMsg = { id: clientMessageId, role: 'user', content: userVisibleText, body: { text: userVisibleText, attachments: attachmentPreviews, source }, attachmentPreviews, source, createdAt: Date.now() };
    messages.push(userMsg);
    liveMsg = { id: `${clientMessageId}_agent`, role: 'agent', content: '', source, _progress: `${agent.name} is thinking...`, createdAt: Date.now(), workStartedAt: Date.now(), streaming: true, processEntries: [] };
    messages.push(liveMsg);
    renderList();

    localSseActive = true;
    composer?.update?.();
    let resolveCompletion = () => {};
    const completionPromise = new Promise((resolve) => { resolveCompletion = resolve; });
    currentStream = streamSubagentChat(agent.id, {
      message: messageForRuntime,
      clientMessageId,
      attachmentPreviews,
      ...(isVoiceTurn && userVisibleText && userVisibleText !== messageForRuntime ? { visibleMessage: userVisibleText } : {}),
      ...(source ? { source } : {}),
      ...(isVoiceTurn ? { voiceTarget: _mobileVoiceTargetPayload() } : {}),
    }, {
      onEvent: (evt) => {
        if (!liveMsg) return;
        _applyMobileAgentStreamEvent(liveMsg, evt, agent.name || agent.id || 'Subagent');
        renderList();
      },
      onError: (err) => {
        if (err?.name === 'AbortError') return;
        const target = liveMsg;
        if (!target) return;
        target.content = target.content || `Error: ${err?.message || 'stream failed'}`;
        target._progress = '';
        target.streaming = false;
        target.workEndedAt = Date.now();
        localSseActive = false;
        currentStream = null;
        attachStream?.(null);
        composer?.update?.();
        renderList();
        resolveCompletion();
      },
      onDone: async () => {
        const finalSubagentVoiceReply = String(liveMsg?.content || liveMsg?.text || '').trim();
        if (liveMsg) {
          liveMsg._progress = '';
          liveMsg.streaming = false;
          liveMsg.workEndedAt = liveMsg.workEndedAt || Date.now();
          liveMsg.workDurationMs = Math.max(0, liveMsg.workEndedAt - Number(liveMsg.workStartedAt || liveMsg.createdAt || liveMsg.workEndedAt));
        }
        localSseActive = false;
        currentStream = null;
        attachStream?.(null);
        composer?.update?.();
        await reconcile({ forceHistory: true });
        if (
          finalSubagentVoiceReply
          && isVoiceTurn
          && __pmVoice?.target?.kind === 'subagent'
          && String(__pmVoice.target.agentId || '') === String(agent.id || '')
        ) {
          await _deliverSubagentVoiceReplyOnce(agent.id, finalSubagentVoiceReply).catch(() => {});
        }
        drainQueueSoon();
        resolveCompletion();
      },
    });
    attachStream?.(currentStream);
    return completionPromise;
  }

  composer = _installMobileAgentComposer(slot, 'pm-sa-chat', {
    placeholder: `Message ${agent.name || 'this subagent'}...`,
    draftKey: `subagent:${agent.id || ''}`,
    isBusy,
    onAbort: () => {
      try { currentStream?.abort?.(); } catch {}
      if (liveMsg) {
        liveMsg._progress = 'Stopping...';
        liveMsg.streaming = false;
      }
      currentStream = null;
      attachStream?.(null);
      localSseActive = false;
      renderList();
    },
    onSubmit: startSubagentMobileSend,
    onVoiceSubmit: startSubagentMobileSend,
    voiceTarget: {
      agentId: agent.id,
      label: agent.name || agent.id || 'Subagent',
      voice: agent.voice || agent.raw?.voice || null,
    },
  });
  const composerForm = slot.querySelector('#pm-sa-chat-form');
  const updateComposerLayout = () => {
    if (composerLayoutRaf) cancelAnimationFrame(composerLayoutRaf);
    composerLayoutRaf = requestAnimationFrame(() => {
      composerLayoutRaf = 0;
      const height = Math.ceil(composerForm?.getBoundingClientRect?.().height || 0);
      slot.style.setProperty('--pm-sa-chat-composer-space', `${Math.max(132, height + 28)}px`);
      scrollToLatest();
    });
  };
  if (typeof ResizeObserver !== 'undefined' && composerForm) {
    composerResizeObserver = new ResizeObserver(updateComposerLayout);
    composerResizeObserver.observe(composerForm);
  }
  if (typeof ResizeObserver !== 'undefined' && listEl) {
    historyResizeObserver = new ResizeObserver(() => {
      if (pinInitialHistoryToBottom) scrollToLatest();
    });
    historyResizeObserver.observe(listEl);
  }
  initialBottomPinTimer = setTimeout(() => { pinInitialHistoryToBottom = false; }, 900);
  updateComposerLayout();
  renderQueue();
}
