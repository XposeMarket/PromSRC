// Hub route owner. Loaded only when its route or a shared dependent feature is requested.
import {
  ICONS,
  _pmCssEscape,
  _pmHumanApproval,
  _renderMobileMarkdown,
  escapeHtml,
  getAccount,
  loadMobileAuditRuns,
  loadMobileHubGoals,
  loadMobileHubOverview,
  loadMobileMoreSummary,
  pmToast,
  renderMobileHeader,
  wireHeaderActions,
  wsEventBus,
} from './mobile-pages.js';

import { memoryPageActivate, memoryPageUnmount } from '../pages/MemoryPage.js';

/* ---------------- MORE / HUB / AUDIT / MEMORY ---------------- */

function _pmCompactNumber(value, suffix = '') {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return suffix ? `0${suffix}` : '0';
  if (Math.abs(n) >= 1_000_000_000) return `${Math.round(n / 100_000_000) / 10}B${suffix}`;
  if (Math.abs(n) >= 1_000_000) return `${Math.round(n / 100_000) / 10}M${suffix}`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 100) / 10}K${suffix}`;
  return `${Math.round(n).toLocaleString()}${suffix}`;
}

function _pmDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function _pmGoalTitle(goal) {
  return String(goal?.title || goal?.goal || goal?.userRequest || goal?.summary || goal?.id || 'Latest goal').trim();
}

function _pmGoalBody(goal) {
  return String(goal?.summary || goal?.result || goal?.assistantSummary || goal?.description || goal?.lastAssistantMessage || '').trim();
}

function _pmStatusPill(status) {
  const s = String(status || '').toLowerCase();
  if (['running', 'pending', 'executing'].includes(s)) return `<span class="pm-pill running">running</span>`;
  if (['failed', 'rejected', 'denied'].includes(s)) return `<span class="pm-pill orange">failed</span>`;
  if (['complete', 'completed', 'done', 'approved', 'auto'].includes(s)) return `<span class="pm-pill active">complete</span>`;
  return `<span class="pm-pill gray">${escapeHtml(s || 'unknown')}</span>`;
}

function _pmToolAction(toolName, actionType) {
  const t = String(toolName || '').toLowerCase();
  const a = String(actionType || '').toLowerCase();
  if (a.includes('proposal') || t.includes('proposal')) return 'proposal';
  if (t.includes('delete') || t.includes('remove')) return 'delete';
  if (t.includes('type') || t.includes('fill')) return 'type';
  if (t.includes('click') || t.includes('press')) return 'click';
  if (t.includes('command') || t === 'shell') return 'cmd';
  if (t.includes('write') || t.includes('edit') || t.includes('create') || t.includes('append')) return 'edit';
  if (t.includes('read') || t.includes('list') || t.includes('search') || t.includes('stat') || t.includes('grep')) return 'read';
  return 'other';
}

function _pmAuditStats(runs) {
  const stats = { total: 0, read: 0, edit: 0, delete: 0, type: 0, click: 0, cmd: 0, proposal: 0, approved: 0, rejected: 0, pending: 0 };
  for (const run of runs || []) {
    for (const tool of run.tools || []) {
      stats.total++;
      const action = _pmToolAction(tool.toolName, tool.actionType);
      if (stats[action] !== undefined) stats[action]++;
      const approval = String(tool.approvalStatus || '').toLowerCase();
      if (approval === 'approved') stats.approved++;
      else if (approval === 'rejected') stats.rejected++;
      else if (approval === 'pending') stats.pending++;
    }
  }
  return stats;
}

function _pmTopTools(tools, limit = 3) {
  const counts = new Map();
  for (const tool of tools || []) {
    const name = String(tool.toolName || 'tool');
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function _pmProposalPriority(proposal) {
  const p = String(proposal?.priority || 'medium').toLowerCase();
  const cls = p === 'critical' || p === 'high' ? 'orange' : p === 'low' ? 'gray' : 'blue';
  return `<span class="pm-proposal-badge ${cls}">${escapeHtml(p.toUpperCase())}</span>`;
}

function _pmProposalStatus(proposal) {
  const s = String(proposal?.status || 'pending').toLowerCase();
  if (s === 'pending') return '<span class="pm-proposal-status pending">PENDING</span>';
  if (s === 'executing' || s === 'repairing') return '<span class="pm-proposal-status running">RUNNING</span>';
  if (s === 'executed' || s === 'approved') return '<span class="pm-proposal-status complete">APPROVED</span>';
  if (s === 'denied' || s === 'failed') return '<span class="pm-proposal-status denied">DENIED</span>';
  return `<span class="pm-proposal-status">${escapeHtml(s.toUpperCase())}</span>`;
}

function _pmProposalFiles(proposal, limit = 2) {
  const files = Array.isArray(proposal?.affectedFiles) ? proposal.affectedFiles.slice(0, limit) : [];
  const extra = Array.isArray(proposal?.affectedFiles) ? proposal.affectedFiles.length - files.length : 0;
  const chips = files.map((f) => `<span>${escapeHtml(f?.action || 'touch')}: ${escapeHtml(f?.path || '')}</span>`);
  if (extra > 0) chips.push(`<span>+${extra} more</span>`);
  return chips.length ? `<div class="pm-proposal-files">${chips.join('')}</div>` : '';
}

function _pmProposalExecutionStepStatus(proposal, step) {
  const explicit = String(step?.status || step?.state || '').trim().toLowerCase();
  if (explicit) return explicit.replace(/\s+/g, '_');
  const proposalStatus = String(proposal?.status || '').trim().toLowerCase();
  return ['approved', 'executing', 'repairing', 'executed'].includes(proposalStatus) ? 'approved' : 'pending';
}

function _pmIsApprovedExecutionStep(proposal, step) {
  return step?.approved === true || step?.isApproved === true || _pmProposalExecutionStepStatus(proposal, step) === 'approved';
}

function _pmProposalSteps(proposal) {
  const steps = Array.isArray(proposal?.executionSteps) ? proposal.executionSteps : [];
  if (!steps.length) return '';
  return `<section class="pm-card pm-more-section"><div class="pm-card-head">Approved Execution Steps</div><div class="pm-proposal-steps">${steps.map((step, idx) => {
    const title = String(step?.title || step?.description || `Step ${idx + 1}`);
    const kind = String(step?.kind || '').trim();
    const success = String(step?.successCriteria || step?.success_criteria || '').trim();
    const status = _pmProposalExecutionStepStatus(proposal, step);
    const approved = _pmIsApprovedExecutionStep(proposal, step);
    const safeStatus = status.replace(/[^a-z0-9_-]/g, '_');
    return `<div class="pm-proposal-step ${approved ? 'is-approved' : ''} is-${safeStatus}" data-step-status="${escapeHtml(status)}">
      <b>${idx + 1}</b>
      <span><span class="pm-proposal-step-title">${escapeHtml(title)}</span>${success ? `<em>Success: ${escapeHtml(success)}</em>` : ''}</span>
      ${kind ? `<small>${escapeHtml(kind.toUpperCase())}</small>` : ''}
    </div>`;
  }).join('')}</div></section>`;
}

function _pmProposalDetails(proposal) {
  const details = String(proposal?.details || '').trim();
  if (!details) return '';
  return `<section class="pm-card pm-more-section pm-proposal-details">
    <div class="pm-card-head">Details</div>
    <div class="markdown-body">${_renderMobileMarkdown(details)}</div>
  </section>`;
}

function _pmIsDevSourceApproval(approval = {}) {
  const kind = String(approval?.approvalKind || '').trim();
  const tool = String(approval?.toolName || '').trim();
  return kind === 'dev_source_edit' || tool === 'request_dev_source_edit';
}

function _pmCuratorStatus(suggestion) {
  const s = String(suggestion?.status || 'pending').toLowerCase();
  if (s === 'applied') return '<span class="pm-proposal-status complete">APPLIED</span>';
  if (s === 'rejected') return '<span class="pm-proposal-status denied">DENIED</span>';
  if (s === 'quarantined') return '<span class="pm-proposal-status denied">QUARANTINED</span>';
  return '<span class="pm-proposal-status pending">PENDING</span>';
}

function _pmCuratorMarkdownSection(markdown, heading) {
  const text = String(markdown || '');
  const target = String(heading || '').trim().toLowerCase();
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const m = line.match(/^##\s+(.+?)\s*$/);
    return m && m[1].trim().toLowerCase() === target;
  });
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

function _pmCuratorFirstSentence(text, fallback = '') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  const sentence = cleaned.match(/^(.{30,180}?[.!?])(?:\s|$)/);
  return sentence ? sentence[1].trim() : cleaned.slice(0, 180);
}

function _pmCuratorLesson(s, content) {
  if (s?.learnedBehavior) return String(s.learnedBehavior);
  const action = _pmCuratorMarkdownSection(content, 'Suggested Action');
  const outcome = _pmCuratorMarkdownSection(content, 'Outcome Excerpt');
  const kind = String(s?.change?.kind || '').toLowerCase();
  if (kind === 'manifest_overlay') {
    return _pmCuratorFirstSentence(action || s?.reason, 'Updates routing metadata for this skill.');
  }
  return _pmCuratorFirstSentence(action || outcome || s?.reason, 'Adds a reusable lesson from a completed Prometheus run.');
}

function _pmCuratorApplyPreview(s) {
  if (s?.approvePreview) return String(s.approvePreview);
  const change = s?.change || {};
  const skill = String(s?.skillId || 'this skill');
  const path = String(change.path || '').trim();
  if (String(change.kind || '').toLowerCase() === 'manifest_overlay') return `Approve updates ${skill}'s manifest metadata.`;
  if (String(change.kind || '').toLowerCase() === 'review_only') return `Approve marks this daily skill-change audit accepted without changing skill files.`;
  return `Approve adds ${path || 'a resource file'} to ${skill}.`;
}

function _pmCuratorApproveLabel(s) {
  return String(s?.change?.kind || '').toLowerCase() === 'review_only' ? 'Approve audit' : 'Approve and add';
}

function _pmCuratorCards(suggestions = []) {
  const rows = Array.isArray(suggestions) ? suggestions.slice() : [];
  rows.sort((a, b) => {
    const ap = String(a?.status || '').toLowerCase() === 'pending' ? 0 : 1;
    const bp = String(b?.status || '').toLowerCase() === 'pending' ? 0 : 1;
    return (ap - bp) || String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || ''));
  });
  if (!rows.length) {
    return `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.target}</div><h2>No curator suggestions</h2><p>Brain skill suggestions will appear here when Prometheus finds reusable skill improvements.</p></div>`;
  }
  return rows.map((s) => {
    const change = s?.change || {};
    const evidence = Array.isArray(s?.evidence) ? s.evidence : [];
    const content = String(change.content || '').trim();
    const lesson = _pmCuratorLesson(s, content);
    const applyPreview = _pmCuratorApplyPreview(s);
    const pending = String(s?.status || '').toLowerCase() === 'pending';
    return `<article class="pm-card pm-proposal-card pm-curator-card" data-curator-id="${escapeHtml(s.id || '')}">
      <div class="pm-proposal-head">
        <span class="pm-more-icon">${ICONS.brain}</span>
        <div>
          <strong>${escapeHtml(s.title || 'Untitled skill suggestion')}</strong>
          <div class="pm-proposal-badges">${_pmCuratorStatus(s)}<span>${escapeHtml(String(s.risk || 'low').toUpperCase())} RISK</span><span>${escapeHtml(s.scan?.verdict || 'scan')}</span></div>
        </div>
        <button class="pm-icon-btn" type="button" data-curator-toggle="${escapeHtml(s.id || '')}" aria-label="Toggle details">${ICONS.dots}</button>
      </div>
      <div class="pm-curator-apply-preview">${escapeHtml(applyPreview)}</div>
      <p class="pm-curator-lesson">${escapeHtml(lesson)}</p>
      ${s.futureTrigger ? `<p class="pm-curator-trigger"><strong>Future trigger</strong>${escapeHtml(s.futureTrigger)}</p>` : ''}
      ${s.whyUseful ? `<p class="pm-curator-why">${escapeHtml(s.whyUseful)}</p>` : ''}
      <p>${escapeHtml(s.reason || '')}</p>
      <div class="pm-proposal-files">
        <span>${escapeHtml(s.skillId || 'unknown skill')}</span>
        <span>${escapeHtml(change.path || change.kind || 'change')}</span>
      </div>
      ${evidence.length ? `<div class="pm-curator-evidence">${evidence.slice(0, 3).map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
      <div class="pm-curator-details" id="pm-curator-details-${escapeHtml(s.id || '')}" hidden>
        <div class="pm-more-meta-row"><span>ID</span><span>${escapeHtml(s.id || '')}</span></div>
        <div class="pm-more-meta-row"><span>Updated</span><span>${escapeHtml(_pmDateTime(s.updatedAt))}</span></div>
        ${content ? `<pre>${escapeHtml(content.slice(0, 1800))}${content.length > 1800 ? '\n...' : ''}</pre>` : ''}
      </div>
      <div class="pm-proposal-actions">
        ${pending ? `<button class="pm-btn success pm-proposal-action-btn" data-approve-curator="${escapeHtml(s.id || '')}">${escapeHtml(_pmCuratorApproveLabel(s))}</button><button class="pm-btn danger pm-proposal-action-btn" data-deny-curator="${escapeHtml(s.id || '')}">Deny</button>` : ''}
      </div>
    </article>`;
  }).join('');
}









function _pmApprovalSummary(approval) {
  return _pmHumanApproval(approval).summary;
}







function _pmAppendProcessTerminalChunk(runId, chunk, stream = 'stdout') {
  const id = String(runId || '').trim();
  const el = id ? document.querySelector(`[data-pm-process-output="${_pmCssEscape(id)}"]`) : null;
  const card = id ? document.querySelector(`[data-pm-process-run="${_pmCssEscape(id)}"]`) : null;
  if (!el || !card || !chunk) return;
  const tab = card.getAttribute('data-pm-process-tab') || 'combined';
  if (tab !== 'combined' && tab !== stream) return;
  const wasNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.textContent = `${el.textContent === 'No output yet.' ? '' : el.textContent}${chunk}`;
  if (wasNearBottom) el.scrollTop = el.scrollHeight;
}

function _pmInstallProcessRunLiveStream() {
  if (window.__pmMobileProcessRunLiveInstalled) return;
  window.__pmMobileProcessRunLiveInstalled = true;
  const bus = window.wsEventBus || wsEventBus;
  bus?.on?.('process_run_output', (msg = {}) => {
    const runId = String(msg.run?.runId || msg.runId || '').trim();
    _pmAppendProcessTerminalChunk(runId, String(msg.chunk || ''), String(msg.stream || 'stdout'));
  });
  ['process_run_started', 'process_run_update', 'process_run_exited'].forEach((eventName) => {
    bus?.on?.(eventName, (msg = {}) => {
      const run = msg.run || {};
      const runId = String(run.runId || msg.runId || '').trim();
      const card = runId ? document.querySelector(`[data-pm-process-run="${_pmCssEscape(runId)}"]`) : null;
      if (!card) return;
      const state = String(run.state || run.status || '').toLowerCase();
      const pill = card.querySelector('.pm-process-pill');
      const live = card.querySelector('.pm-process-live-state');
      if (pill && state) {
        pill.textContent = state;
        pill.className = `pm-process-pill ${state}`;
      }
      if (live) live.textContent = state === 'exited' ? 'completed' : 'streaming';
    });
  });
}

_pmInstallProcessRunLiveStream();

















function _pmSparkBars(series, key = 'count', limit = 14) {
  const items = (Array.isArray(series) ? series : []).slice(-limit);
  if (!items.length) return '<div class="pm-more-bars empty"></div>';
  const max = Math.max(1, ...items.map((x) => Number(x?.[key] || x?.tokens || x?.count || 0)));
  return `<div class="pm-more-bars">${items.map((x) => {
    const value = Number(x?.[key] || x?.tokens || x?.count || 0);
    const h = Math.max(8, Math.round((value / max) * 54));
    return `<span style="height:${h}px" title="${escapeHtml(String(value))}"></span>`;
  }).join('')}</div>`;
}

function _pmMemoryDots(nodes, limit = 120) {
  const list = (Array.isArray(nodes) ? nodes : []).slice(0, limit);
  const dots = list.map((node, idx) => {
    const degree = Number(node?.degree || 0);
    const angle = (idx * 137.5) * Math.PI / 180;
    const radius = 8 + Math.sqrt(idx + 1) * 7.2;
    const x = 50 + Math.cos(angle) * Math.min(radius, 43);
    const y = 50 + Math.sin(angle) * Math.min(radius, 43);
    const hue = degree > 6 ? '#ff8a2a' : degree > 3 ? '#a78bfa' : '#55c4ff';
    return `<i style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;background:${hue};"></i>`;
  }).join('');
  return `<div class="pm-memory-orbit" aria-hidden="true"><div class="pm-memory-core"></div>${dots}</div>`;
}

function _parkDesktopMemoryIds() {
  const view = document.getElementById('memory-view');
  if (!view || view.dataset.pmIdsParked === '1') return () => {};
  const changed = [];
  view.querySelectorAll('[id]').forEach((node) => {
    const id = node.getAttribute('id');
    if (!id || !id.startsWith('memory-')) return;
    node.setAttribute('data-pm-original-id', id);
    node.setAttribute('id', `desktop-${id}`);
    changed.push(node);
  });
  view.dataset.pmIdsParked = '1';
  return () => {
    changed.forEach((node) => {
      const original = node.getAttribute('data-pm-original-id');
      if (!original) return;
      node.setAttribute('id', original);
      node.removeAttribute('data-pm-original-id');
    });
    delete view.dataset.pmIdsParked;
  };
}

function _pmMoreSkeleton() {
  return `<div class="pm-more-skeleton"><span></span><span></span><span></span></div>`;
}

function _pmModelTotal(stats = {}) {
  return Number(stats.totalTokens ?? stats.total ?? 0) || 0;
}

function _pmModelCalls(stats = {}) {
  return Number(stats.modelCalls ?? stats.messages ?? 0) || 0;
}

function _pmStatCard(label, value, sub = '') {
  return `<span><b>${escapeHtml(String(value))}</b><em>${escapeHtml(label)}</em>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span>`;
}

function _pmScheduleInitialLoad(page, load, { retryOnWsOpen = true } = {}) {
  if (!page || typeof load !== 'function') return;
  let loaded = false;
  let running = false;
  let disposed = false;
  const previousCleanup = typeof page._pmCleanup === 'function' ? page._pmCleanup : null;
  const run = async () => {
    if (disposed || running || loaded) return;
    running = true;
    try {
      loaded = await load() !== false;
    } finally {
      running = false;
    }
  };
  const timer = setTimeout(() => requestAnimationFrame(run), 0);
  const onWsOpen = () => {
    if (!loaded) setTimeout(run, 120);
  };
  if (retryOnWsOpen) wsEventBus?.on?.('ws:open', onWsOpen);
  page._pmCleanup = () => {
    disposed = true;
    clearTimeout(timer);
    if (retryOnWsOpen) wsEventBus?.off?.('ws:open', onWsOpen);
    previousCleanup?.();
  };
}

function _renderMoreLanding(page, { navigate }) {
  const extras = `<span class="pm-spacer"></span><button class="pm-icon-btn" id="pm-more-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'More', online: true, extras, hideTitle: true, hideBrand: true })}
    <div class="pm-body pm-more-page" id="pm-more-body">
      ${_pmMoreSkeleton()}
    </div>
  `;
  wireHeaderActions(page, {});
  const body = page.querySelector('#pm-more-body');

  const paint = (data) => {
    const recentRuns = Array.isArray(data?.audit?.runs) ? data.audit.runs : [];
    const recentMemory = Array.isArray(data?.memory?.recent) ? data.memory.recent : [];
    body.innerHTML = `
      <button class="pm-more-card pm-more-card-audit" data-route="#mobile/more/audit" type="button">
        <div class="pm-more-card-top">
          <span class="pm-more-icon">${ICONS.clipboard}</span>
          <span><strong>Audit</strong><em>Recent non-main agent runs</em></span>
          <span class="pm-chev">${ICONS.chev}</span>
        </div>
        <div class="pm-run-mini-list">
          ${recentRuns.length ? recentRuns.slice(0, 3).map((run) => `
            <span>
              <b>${escapeHtml(run.kind || run.agentId || 'Agent Run')}</b>
              <em>${escapeHtml(_pmDateTime(run.endedAt || run.startedAt))}</em>
              ${_pmStatusPill(run.status)}
            </span>
          `).join('') : '<p>No agent runs recorded yet.</p>'}
        </div>
      </button>

      <button class="pm-more-card pm-more-card-memory" data-route="#mobile/more/memory" type="button">
        <div class="pm-more-card-top">
          <span class="pm-more-icon">${ICONS.brain}</span>
          <span><strong>Memory</strong><em>Latest graph additions</em></span>
          <span class="pm-chev">${ICONS.chev}</span>
        </div>
        <div class="pm-memory-mini">
          ${_pmMemoryDots(recentMemory, 28)}
          <div class="pm-memory-mini-list">
            ${recentMemory.length ? recentMemory.map((item) => `
              <span><b>${escapeHtml(item.title)}</b><em>${escapeHtml(item.type)} - ${escapeHtml(_pmDateTime(item.timestamp))}</em></span>
            `).join('') : '<p>No non-chat memory graph items yet.</p>'}
          </div>
        </div>
      </button>

      <div class="pm-more-card" style="cursor:default;">
        <div class="pm-more-card-top">
          <span class="pm-more-icon">${ICONS.refresh}</span>
          <span><strong>App health</strong><em>Force a fresh asset reload if the app feels stuck</em></span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;padding-top:6px;">
          <button class="pm-btn ghost" id="pm-more-purge" type="button" style="justify-content:center;">↻ Reload latest assets</button>
          <button class="pm-btn ghost" id="pm-more-repair" type="button" style="justify-content:center;color:var(--pm-red);">🚑 Full reset (re-pair required)</button>
          <span style="font-size:11px;color:var(--pm-muted);line-height:1.5;">Use this if a refresh sends you to the desktop UI, scanning a QR shows the desktop site, or actions stop working after a gateway restart.</span>
        </div>
      </div>
    `;
    body.querySelectorAll('[data-route]').forEach((btn) => btn.addEventListener('click', () => navigate(btn.getAttribute('data-route'))));

    body.querySelector('#pm-more-purge')?.addEventListener('click', async () => {
      pmToast('Refreshing assets…', 'info');
      try { await window.pmPurgeCaches?.(); } catch { window.location.reload(); }
    });
    body.querySelector('#pm-more-repair')?.addEventListener('click', async () => {
      if (!confirm('Full reset will clear caches, sign this device out of pairing, and reload. Continue?')) return;
      try {
        localStorage.removeItem('pm_device_token');
        localStorage.removeItem('pm_device_id');
        localStorage.removeItem('pm_force_mobile');
      } catch {}
      try { await window.pmPurgeCaches?.(); } catch { window.location.reload(); }
    });
  };

  // Render the (navigational) cards immediately with empty previews so the page
  // is instantly usable, then fill in the preview stats once the summary
  // resolves. The previous version blocked on a skeleton until all 5 analytics
  // requests inside loadMobileMoreSummary() finished, which could hang the More
  // page for ~10s on the slowest endpoint.
  paint(null);

  const load = async () => {
    try {
      paint(await loadMobileMoreSummary());
      return true;
    } catch (err) {
      pmToast(`Could not refresh More: ${err.message || ''}`, 'error');
      return false;
    }
  };
  page.querySelector('#pm-more-refresh')?.addEventListener('click', load);
  _pmScheduleInitialLoad(page, load);
}

function _pmHubAccount() {
  let account = null;
  try { account = getAccount?.(); } catch {}
  const rawEmail = String(account?.email || account?.user?.email || '').trim();
  const rawName = String(account?.name || account?.displayName || account?.user?.name || rawEmail.split('@')[0] || 'Prometheus').trim();
  const name = rawName.replace(/^@/, '') || 'Prometheus';
  const handleBase = rawEmail ? rawEmail.split('@')[0] : name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return { name, handle: handleBase ? `@${handleBase}` : '@local' };
}

function _pmHubInitials(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const initials = parts.length >= 2 ? `${parts[0][0] || ''}${parts[1][0] || ''}` : String(name || 'P').slice(0, 2);
  return initials.toUpperCase() || 'PM';
}

function _pmHubStat(label, value) {
  return `<span><b>${escapeHtml(String(value))}</b><em>${escapeHtml(label)}</em></span>`;
}

function _pmHubLatestGoalSection(latestGoal, loading = false) {
  const title = loading
    ? 'Loading latest goal…'
    : (latestGoal ? _pmGoalTitle(latestGoal) : 'No goals yet');
  const body = loading
    ? 'Your most recently updated goal will appear here.'
    : (latestGoal ? (_pmGoalBody(latestGoal) || String(latestGoal.status || 'In progress')) : 'Main chat goals will appear here once Prometheus records them.');
  const timestamp = latestGoal ? _pmDateTime(latestGoal.updatedAt || latestGoal.completedAt || latestGoal.createdAt) : '';
  return `
    <section class="pm-hub-profile-section" id="pm-hub-latest-goal">
      <div class="pm-hub-section-head"><strong>Latest goal</strong><span>${escapeHtml(timestamp)}</span></div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(body)}</p>
    </section>
  `;
}

function _pmTokenOpacity(value, max) {
  const n = Math.max(0, Number(value) || 0);
  if (n <= 0) return 0;
  const ratio = n / Math.max(1, Number(max) || 1);
  // Preserve detail on light-usage days but reserve fully solid Prometheus
  // gold for the single highest day.
  return Math.min(1, 0.12 + (0.88 * Math.sqrt(ratio)));
}

function _pmTokenActivityPopover(cell) {
  const date = String(cell?.dataset?.date || '');
  const tokens = Math.max(0, Number(cell?.dataset?.tokens || 0));
  if (!date) return;
  document.getElementById('pm-token-activity-popover')?.remove();
  const popover = document.createElement('div');
  popover.id = 'pm-token-activity-popover';
  popover.className = 'pm-token-activity-popover';
  const formattedDate = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
  popover.innerHTML = `<strong>${escapeHtml(formattedDate)}</strong><span>${escapeHtml(_pmCompactNumber(tokens))} tokens</span>`;
  document.body.appendChild(popover);
  const rect = cell.getBoundingClientRect();
  const margin = 8;
  const popWidth = popover.offsetWidth || 164;
  const popHeight = popover.offsetHeight || 52;
  let left = rect.left + (rect.width / 2) - (popWidth / 2);
  let top = rect.top - popHeight - margin;
  if (top < margin) top = rect.bottom + margin;
  left = Math.max(margin, Math.min(left, window.innerWidth - popWidth - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - popHeight - margin));
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function _wirePmTokenActivityPopover(scope) {
  const cells = Array.from(scope?.querySelectorAll?.('.pm-hub-token-cell[data-date]') || []);
  if (!cells.length) return;
  let activePointerId = null;
  let dismissTimer = null;
  const dismiss = () => {
    if (dismissTimer) clearTimeout(dismissTimer);
    dismissTimer = null;
    document.getElementById('pm-token-activity-popover')?.remove();
  };
  const show = (cell) => {
    if (!cell) return;
    if (dismissTimer) clearTimeout(dismissTimer);
    _pmTokenActivityPopover(cell);
  };
  const cellAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('.pm-hub-token-cell[data-date]');
  const endTouch = () => {
    activePointerId = null;
    window.removeEventListener('pointermove', moveTouch, true);
    window.removeEventListener('pointerup', endTouch, true);
    window.removeEventListener('pointercancel', endTouch, true);
    dismissTimer = setTimeout(dismiss, 850);
  };
  const moveTouch = (event) => {
    if (activePointerId !== event.pointerId) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (cell) show(cell);
  };
  cells.forEach((cell) => {
    cell.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      activePointerId = event.pointerId;
      show(cell);
      window.addEventListener('pointermove', moveTouch, true);
      window.addEventListener('pointerup', endTouch, true);
      window.addEventListener('pointercancel', endTouch, true);
    });
    cell.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') show(cell);
    });
    cell.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse' && activePointerId === null) dismiss();
    });
  });
}

function _pmTokenActivityGrid(activity = {}) {
  const daily = Array.isArray(activity?.daily) ? activity.daily : [];
  if (!daily.length) {
    return `<div class="pm-hub-token-empty">No token activity recorded yet.</div>`;
  }
  const first = new Date(`${daily[0].date}T00:00:00`);
  const leading = Number.isFinite(first.getTime()) ? first.getDay() : 0;
  const values = daily.map((row) => Math.max(0, Number(row.tokens || row.count || 0)));
  const max = Math.max(1, ...values);
  const weeks = Math.ceil((leading + daily.length) / 7);
  const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day) => `<span>${day}</span>`).join('');
  let cells = '';
  for (let i = 0; i < leading; i++) cells += '<i class="empty"></i>';
  daily.forEach((row) => {
    const tokens = Math.max(0, Number(row.tokens || row.count || 0));
    const title = `${row.date}: ${_pmCompactNumber(tokens)} tokens`;
    const activity = tokens > 0 ? 'true' : 'false';
    const opacity = _pmTokenOpacity(tokens, max).toFixed(3);
    cells += `<i class="pm-hub-token-cell" data-date="${escapeHtml(row.date)}" data-tokens="${tokens}" data-active="${activity}" style="--pm-token-alpha:${opacity}" aria-label="${escapeHtml(title)}"></i>`;
  });
  const months = [];
  const seen = new Set();
  daily.forEach((row, index) => {
    const [year, month] = String(row.date || '').split('-');
    const key = `${year}-${month}`;
    if (!year || !month || seen.has(key)) return;
    seen.add(key);
    const d = new Date(`${row.date}T00:00:00`);
    months.push(`<span style="grid-column:${Math.floor((leading + index) / 7) + 1}">${escapeHtml(d.toLocaleDateString(undefined, { month: 'short' }))}</span>`);
  });
  return `
    <div class="pm-hub-token-calendar" style="--pm-token-weeks:${weeks}">
        <div class="pm-hub-token-labels">${labels}</div>
        <div class="pm-hub-token-grid-wrap">
          <div class="pm-hub-token-months">${months.join('')}</div>
          <div class="pm-hub-token-cells">${cells}</div>
        </div>
    </div>
  `;
}

export async function renderHubPage(page, { navigate } = {}) {
  const extras = `<span class="pm-spacer"></span><button class="pm-icon-btn" id="pm-hub-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Hub', online: true, extras, hideTitle: true, hideBrand: true })}
    <div class="pm-body pm-hub-profile-page" id="pm-hub-body">${_pmMoreSkeleton()}</div>
  `;
  wireHeaderActions(page, {});
  const body = page.querySelector('#pm-hub-body');
  let loadGeneration = 0;
  const load = async () => {
    try {
      const generation = ++loadGeneration;
      body.innerHTML = _pmMoreSkeleton();
      const data = await loadMobileHubOverview();
      const account = _pmHubAccount();
      const latestGoal = data.goals[0];
      const modelStats = data.models || {};
      const toolStats = data.tools || {};
      const tokenActivity = data.tokenActivity || { daily: [], stats: {} };
      const tokenStats = tokenActivity.stats || {};
      const totalTokens = Number(tokenStats.totalTokens || _pmModelTotal(modelStats)) || 0;
      const peakTokens = Number(tokenStats.peakTokens || 0) || 0;
      const activeDays = Number(tokenStats.activeDays || toolStats.activeDays || modelStats.activeDays || 0) || 0;
      const currentStreak = Number(tokenStats.current ?? tokenStats.currentStreak ?? toolStats.currentStreak ?? modelStats.currentStreak ?? 0) || 0;
      const longestStreak = Number(tokenStats.longest ?? tokenStats.longestStreak ?? toolStats.longestStreak ?? modelStats.longestStreak ?? 0) || 0;
      const toolCalls = Number(toolStats.toolCalls || toolStats.total || 0) || 0;
      const topModels = Array.isArray(data.topModels) ? data.topModels : [];
      const topTools = Array.isArray(data.topTools) ? data.topTools : [];
      body.innerHTML = `
        <section class="pm-hub-profile-hero">
          <div class="pm-hub-avatar">${escapeHtml(_pmHubInitials(account.name))}</div>
          <h1>${escapeHtml(account.name)}</h1>
          <p><span>${escapeHtml(account.handle)}</span><span>Prometheus</span></p>
        </section>
        <section class="pm-hub-profile-stats">
          ${_pmHubStat('Lifetime tokens', _pmCompactNumber(totalTokens))}
          ${_pmHubStat('Peak tokens', _pmCompactNumber(peakTokens))}
          ${_pmHubStat('Model calls', _pmCompactNumber(_pmModelCalls(modelStats)))}
          ${_pmHubStat('Current streak', `${currentStreak}d`)}
          ${_pmHubStat('Longest streak', `${longestStreak}d`)}
        </section>
        <section class="pm-hub-profile-section">
          <div class="pm-hub-section-head">
            <strong>Token activity</strong>
            <span>${escapeHtml(_pmCompactNumber(totalTokens))} total</span>
          </div>
          ${_pmTokenActivityGrid(tokenActivity)}
        </section>
        <section class="pm-hub-profile-columns">
          <div class="pm-hub-profile-section">
            <div class="pm-hub-section-head"><strong>Activity insights</strong></div>
            <div class="pm-hub-insight-list">
              <span><em>Active days</em><b>${escapeHtml(_pmCompactNumber(activeDays))}</b></span>
              <span><em>Tool calls</em><b>${escapeHtml(_pmCompactNumber(toolCalls))}</b></span>
              <span><em>Sessions</em><b>${escapeHtml(_pmCompactNumber(toolStats.chatSessions || modelStats.chatSessions || 0))}</b></span>
              <span><em>Peak hour</em><b>${escapeHtml(String(toolStats.peakHour || modelStats.peakHour || '-'))}</b></span>
            </div>
          </div>
          <div class="pm-hub-profile-section">
            <div class="pm-hub-section-head"><strong>Most used models</strong></div>
            <div class="pm-hub-usage-list">
              ${topModels.slice(0, 4).map((m) => `<span><b>${escapeHtml(m.name || 'Model')}</b><em>${escapeHtml(_pmCompactNumber(m.tokens || 0))} tokens</em></span>`).join('') || '<p>No model usage yet.</p>'}
            </div>
          </div>
        </section>
        ${_pmHubLatestGoalSection(latestGoal, data.goalsLoaded === false)}
        <section class="pm-hub-profile-section">
          <div class="pm-hub-section-head"><strong>Most used tools</strong></div>
          <div class="pm-hub-usage-list">
            ${topTools.slice(0, 6).map((t) => `<span><b>${escapeHtml(t.name || 'Tool')}</b><em>${escapeHtml(_pmCompactNumber(t.count || 0))} calls</em></span>`).join('') || '<p>No tool usage yet.</p>'}
          </div>
        </section>
      `;
      _wirePmTokenActivityPopover(body);
      if (data.goalsLoaded === false) {
        loadMobileHubGoals().then((goals) => {
          if (generation !== loadGeneration || !body.isConnected) return;
          const goalSlot = body.querySelector('#pm-hub-latest-goal');
          if (goalSlot) goalSlot.outerHTML = _pmHubLatestGoalSection(goals[0] || null);
        }).catch(() => {});
      }
      return true;
    } catch (err) {
      body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.target}</div><h2>Could not load Hub</h2><p>${escapeHtml(err.message || '')}</p></div>`;
      return false;
    }
  };
  page.querySelector('#pm-hub-refresh')?.addEventListener('click', load);
  _pmScheduleInitialLoad(page, load);
}

async function _renderMoreAudit(page, { navigate }) {
  const extras = `<span class="pm-spacer"></span><button class="pm-icon-btn" id="pm-audit-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Audit', leftIcon: 'back', onBack: () => navigate('#mobile/more'), online: true, extras, hideTitle: true, hideBrand: true })}
    <div class="pm-body pm-more-page" id="pm-audit-body">${_pmMoreSkeleton()}</div>
  `;
  wireHeaderActions(page, { onBack: () => navigate('#mobile/more') });
  const body = page.querySelector('#pm-audit-body');
  let expanded = '';
  let runs = [];
  const paint = () => {
    const stats = _pmAuditStats(runs);
    body.innerHTML = `
      <div class="pm-audit-filter-row">
        <label>${ICONS.chat}<input id="pm-audit-search" type="search" placeholder="Filter by tool or activity..." value=""></label>
        <button type="button" id="pm-audit-clear">${ICONS.refresh}</button>
      </div>
      <div class="pm-audit-stat-grid">
        ${[
          ['total', stats.total], ['read', stats.read], ['edit', stats.edit], ['delete', stats.delete], ['type', stats.type],
          ['click', stats.click], ['cmd', stats.cmd], ['proposal', stats.proposal], ['approved', stats.approved], ['rejected', stats.rejected], ['pending', stats.pending],
        ].map(([label, value]) => `<span class="${label}"><b>${escapeHtml(_pmCompactNumber(value))}</b><em>${escapeHtml(String(label).toUpperCase())}</em></span>`).join('')}
      </div>
      ${runs.length ? `<div class="pm-audit-run-list">${runs.slice(0, 40).map((run) => {
      const isOpen = expanded === run.key;
      const tools = Array.isArray(run.tools) ? run.tools.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))) : [];
      const topTools = _pmTopTools(tools);
      return `<article class="pm-card pm-audit-run-card" data-run-key="${escapeHtml(run.key)}">
        <div class="pm-audit-run-top">
          <span><strong>${escapeHtml(_pmDateTime(run.endedAt || run.startedAt).split(',')[0] || '')}</strong><em>${escapeHtml(new Date(run.endedAt || run.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }))}</em></span>
          <span><strong>${escapeHtml(run.kind || 'Agent Run')}</strong><em>${escapeHtml(run.agentId || 'agent')}</em></span>
          ${_pmStatusPill(run.status)}
        </div>
        <p>${tools.length} tools - Top activity: ${escapeHtml(topTools.map(([name, count]) => `${name} (${count})`).join(', ') || 'none')}</p>
        <div class="pm-more-meta-row"><span>${escapeHtml(run.sessionId || run.key)}</span><span>${isOpen ? 'Collapse' : 'Open'}</span></div>
        ${isOpen ? `<div class="pm-audit-tool-stream">
          ${tools.map((tool) => `<div><b>${escapeHtml(tool.toolName || 'tool')}</b><em>${escapeHtml(tool.actionType || 'event')} - ${escapeHtml(_pmDateTime(tool.timestamp))}</em><span>${escapeHtml(_pmToolAction(tool.toolName, tool.actionType).toUpperCase())}</span>${tool.error ? `<p>${escapeHtml(String(tool.error).slice(0, 240))}</p>` : ''}</div>`).join('')}
        </div>` : ''}
      </article>`;
    }).join('')}</div>` : `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clipboard}</div><h2>No agent runs yet</h2><p>Non-main agent activity will show up here.</p></div>`}
    `;
    body.querySelectorAll('[data-run-key]').forEach((card) => card.addEventListener('click', () => {
      const key = card.getAttribute('data-run-key') || '';
      expanded = expanded === key ? '' : key;
      paint();
    }));
    const search = body.querySelector('#pm-audit-search');
    const clear = body.querySelector('#pm-audit-clear');
    search?.addEventListener('input', () => {
      const q = String(search.value || '').trim().toLowerCase();
      body.querySelectorAll('.pm-audit-run-card').forEach((card) => {
        card.hidden = q && !card.textContent.toLowerCase().includes(q);
      });
    });
    clear?.addEventListener('click', load);
  };
  const load = async () => {
    try {
      body.innerHTML = _pmMoreSkeleton();
      runs = await loadMobileAuditRuns(200);
      paint();
      return true;
    } catch (err) {
      body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clipboard}</div><h2>Could not load Audit</h2><p>${escapeHtml(err.message || '')}</p></div>`;
      return false;
    }
  };
  page.querySelector('#pm-audit-refresh')?.addEventListener('click', load);
  _pmScheduleInitialLoad(page, load);
}

async function _renderMoreMemory(page, { navigate }) {
  const restoreDesktopMemoryIds = _parkDesktopMemoryIds();
  const extras = `<span class="pm-spacer"></span><button class="pm-icon-btn" type="button" onclick="refreshMemoryGraph(true)" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Memory Graph', leftIcon: 'back', onBack: () => navigate('#mobile/more'), online: true, extras, hideTitle: true, hideBrand: true })}
    <div class="pm-body pm-mobile-memory-body" id="pm-memory-body">
      <div class="memory-page-shell pm-mobile-memory-shell">
        <div class="memory-page-header pm-mobile-memory-actions">
          <input id="memory-image-input" type="file" accept="image/*" style="display:none" />
          <button class="memory-action-btn memory-action-btn--primary" type="button" onclick="openAddMemoryDrawer()">+ Add Memory</button>
          <button class="memory-action-btn" type="button" onclick="triggerMemoryImageInput()">Image Shape</button>
          <button id="memory-set-default-btn" class="memory-action-btn" type="button" style="opacity:0.4" onclick="toggleDefaultShape()">Set Image Default</button>
        </div>
        <div class="memory-page-body">
          <div class="memory-graph-panel">
            <div class="memory-graph-toolbar">
              <input id="memory-search-input" class="memory-search-input" type="text" placeholder="Search nodes, summaries, paths..." />
              <div id="memory-graph-stats" class="memory-graph-stats">Loading graph...</div>
            </div>
            <div id="memory-graph-stage" class="memory-graph-stage">
              <canvas id="memory-graph-canvas"></canvas>
              <div id="memory-graph-tooltip" class="memory-graph-tooltip" style="display:none"></div>
              <div id="memory-graph-empty" class="memory-graph-empty">Loading memory graph...</div>
              <div id="memory-drop-overlay" class="memory-drop-overlay" style="display:none">Drop image to reshape node outline</div>
            </div>
          </div>
          <aside id="memory-side-panel" class="memory-side-panel">
            <div class="memory-side-panel-header">
              <div class="memory-side-panel-title">Controls</div>
              <button class="memory-panel-collapse-btn" type="button" onclick="toggleMemoryControlsPanel()">&times;</button>
            </div>
            <section class="memory-panel-card memory-particle-controls">
              <div class="memory-panel-header-line">
                <div class="memory-panel-title">Controls</div>
                <div class="memory-panel-hint">live shaderless canvas</div>
              </div>
              <div class="memory-particle-modes">
                <button class="memory-particle-mode-btn active" type="button" data-memory-particle-mode="galaxy">Galaxy</button>
                <button class="memory-particle-mode-btn" type="button" data-memory-particle-mode="sphere">Sphere</button>
                <button class="memory-particle-mode-btn" type="button" data-memory-particle-mode="wave">Wave</button>
                <button class="memory-particle-mode-btn" type="button" data-memory-particle-mode="tunnel">Tunnel</button>
              </div>
              <div class="memory-control-stack">
                <label class="memory-control memory-control-row">
                  <span>Speed</span>
                  <input id="memory-particle-speed" type="range" min="0" max="200" step="1" value="35" />
                  <div id="memory-particle-speed-value" class="memory-control-value">35</div>
                </label>
                <label class="memory-control memory-control-row">
                  <span>Depth</span>
                  <input id="memory-particle-depth" type="range" min="160" max="900" step="10" value="740" />
                  <div id="memory-particle-depth-value" class="memory-control-value">740</div>
                </label>
                <label class="memory-control memory-control-row">
                  <span>Glow</span>
                  <input id="memory-particle-glow" type="range" min="0" max="100" step="1" value="20" />
                  <div id="memory-particle-glow-value" class="memory-control-value">20</div>
                </label>
              </div>
            </section>
            <section class="memory-panel-card">
              <div class="memory-panel-title">Filters</div>
              <div class="memory-control-stack">
                <label class="memory-control">
                  <span>Source Type</span>
                  <select id="memory-type-filter"><option value="">All records</option></select>
                </label>
                <label class="memory-control">
                  <span>Minimum edge weight</span>
                  <input id="memory-edge-weight" type="range" min="0" max="100" step="1" value="34" />
                  <div id="memory-edge-weight-value" class="memory-control-hint">0.34+</div>
                </label>
                <label class="memory-control memory-check">
                  <input id="memory-show-labels" type="checkbox" />
                  <span>Show labels for important nodes</span>
                </label>
                <label class="memory-control memory-check">
                  <input id="memory-organize-type" type="checkbox" />
                  <span>Organize by type</span>
                </label>
                <label class="memory-control memory-check memory-sub-check">
                  <input id="memory-separate-type" type="checkbox" />
                  <span>Separate</span>
                </label>
                <button id="memory-save-settings" class="memory-filter-save-btn" type="button">Save Settings</button>
              </div>
            </section>
          </aside>
          <button id="memory-controls-fab" class="memory-controls-fab" type="button" style="display:none" onclick="toggleMemoryControlsPanel()">Filters</button>
          <aside id="memory-detail-drawer" class="memory-detail-drawer" style="display:none">
            <div class="memory-detail-drawer-header">
              <div id="memory-drawer-title" class="memory-side-panel-title">Node Detail</div>
              <button class="memory-panel-collapse-btn" type="button" onclick="closeMemoryDetailDrawer()">&times;</button>
            </div>
            <div id="memory-detail-panel" class="memory-detail-panel">
              <div class="memory-detail-empty">Select a node to inspect its summary, source, and related records.</div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  `;
  wireHeaderActions(page, { onBack: () => navigate('#mobile/more') });
  page._pmCleanup = () => {
    memoryPageUnmount();
    restoreDesktopMemoryIds();
  };
  requestAnimationFrame(() => memoryPageActivate());
}

export async function renderMorePage(page, { section = '', navigate }) {
  if (section === 'hub') {
    try { navigate?.('#mobile/hub'); } catch {}
    return renderHubPage(page, { navigate });
  }
  if (section === 'audit') return _renderMoreAudit(page, { navigate });
  if (section === 'memory') return _renderMoreMemory(page, { navigate });
  return _renderMoreLanding(page, { navigate });
}

export {
  _pmDateTime,
  _pmMoreSkeleton,
  _pmProposalDetails,
  _pmProposalFiles,
  _pmProposalPriority,
  _pmProposalStatus,
  _pmProposalSteps,
};
