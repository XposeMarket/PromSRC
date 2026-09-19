import { renderMd } from '../../../utils.js';
import { ensureMobileV2Markdown } from '../../core/markdown.js';
import { errorState, escapeHtml, loading } from '../../ui/page-kit.js';
import { ICONS } from '../../ui/icons.js';

const FILTERS = ['pending', 'executing', 'approved', 'denied', 'executed', 'all'];
const FILTER_LABELS = {
  pending: 'Pending',
  executing: 'In progress',
  approved: 'Approved',
  denied: 'Denied',
  executed: 'Executed',
  all: 'All',
};

function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function jsonText(value) {
  try { return JSON.stringify(value, null, 2) ?? String(value ?? ''); } catch { return String(value ?? ''); }
}

function displayStatus(proposal = {}) {
  const status = String(proposal.status || 'pending').trim().toLowerCase();
  if (status === 'executing' || status === 'repairing') {
    const task = String(proposal.taskStatus || '').trim().toLowerCase();
    const taskLabels = {
      running: ['in progress', 'running'],
      queued: ['queued', 'pending'],
      waiting_subagent: ['in progress', 'running'],
      paused: ['paused', 'pending'],
      stalled: ['stalled', 'denied'],
      needs_assistance: ['needs you', 'running'],
      awaiting_user_input: ['needs you', 'running'],
    };
    if (taskLabels[task]) return { label: taskLabels[task][0], className: taskLabels[task][1] };
  }
  if (status === 'pending' || status === 'queued') return { label: status, className: 'pending' };
  if (status === 'executing' || status === 'repairing') return { label: 'running', className: 'running' };
  if (status === 'approved' || status === 'executed') return { label: status === 'executed' ? 'executed' : 'approved', className: 'complete' };
  if (status === 'denied' || status === 'failed') return { label: status, className: 'denied' };
  return { label: status || 'unknown', className: '' };
}

function priorityBadge(proposal = {}) {
  const priority = String(proposal.priority || 'medium').trim().toLowerCase();
  const className = ['critical', 'high'].includes(priority) ? 'orange' : priority === 'low' ? 'gray' : 'blue';
  return `<span class="pm-proposal-badge ${className}">${escapeHtml(priority.toUpperCase())}</span>`;
}

function statusBadge(proposal = {}) {
  const status = displayStatus(proposal);
  const running = status.className === 'running' ? '<span class="thinking-dot" aria-hidden="true"></span>' : '';
  return `<span class="pm-proposal-status ${status.className}">${escapeHtml(status.label.toUpperCase())}${running}</span>`;
}

function proposalFiles(proposal = {}, limit = 2) {
  const files = Array.isArray(proposal.affectedFiles) ? proposal.affectedFiles : Array.isArray(proposal.files) ? proposal.files : [];
  const chips = files.slice(0, limit).map((file) => {
    if (typeof file === 'string') return `<span>${escapeHtml(file)}</span>`;
    const action = String(file?.action || 'touch').trim();
    const path = String(file?.path || file?.name || 'file').trim();
    return `<span>${escapeHtml(action)}: ${escapeHtml(path)}</span>`;
  });
  if (files.length > limit) chips.push(`<span>+${files.length - limit} more</span>`);
  return chips.length ? `<div class="pm-proposal-files">${chips.join('')}</div>` : '';
}

function stepStatus(proposal, step) {
  const explicit = String(step?.status || step?.state || '').trim().toLowerCase();
  if (explicit) return explicit.replace(/\s+/g, '_');
  return ['approved', 'executing', 'repairing', 'executed'].includes(String(proposal?.status || '').toLowerCase()) ? 'approved' : 'pending';
}

function proposalSteps(proposal = {}) {
  const steps = Array.isArray(proposal.executionSteps)
    ? proposal.executionSteps
    : Array.isArray(proposal.steps) ? proposal.steps : Array.isArray(proposal.plan) ? proposal.plan : [];
  if (!steps.length) return '';
  return `<section class="pm-card pm-more-section"><div class="pm-card-head">Execution Plan</div><div class="pm-proposal-steps">${steps.map((step, index) => {
    const title = String(typeof step === 'string' ? step : step?.title || step?.description || `Step ${index + 1}`);
    const kind = String(step?.kind || '').trim();
    const success = String(step?.successCriteria || step?.success_criteria || '').trim();
    const status = stepStatus(proposal, step);
    const approved = step?.approved === true || step?.isApproved === true || status === 'approved';
    const safeStatus = status.replace(/[^a-z0-9_-]/g, '_');
    return `<div class="pm-proposal-step${approved ? ' is-approved' : ''} is-${safeStatus}" data-step-status="${escapeHtml(status)}">
      <b>${index + 1}</b><span><span class="pm-proposal-step-title">${escapeHtml(title)}</span>${success ? `<em>Success: ${escapeHtml(success)}</em>` : ''}</span>${kind ? `<small>${escapeHtml(kind.toUpperCase())}</small>` : ''}
    </div>`;
  }).join('')}</div></section>`;
}

function proposalHeader(filter = 'pending') {
  return `<div class="pm-v2-page-heading pm-proposals-heading">
    <div><h1>Proposals</h1><p>Review agent-generated work before it runs.</p></div>
    <div class="pm-v2-heading-actions">
      <select class="pm-select" data-proposal-filter aria-label="Filter proposals">${FILTERS.map((value) => `<option value="${value}"${value === filter ? ' selected' : ''}>${FILTER_LABELS[value]}</option>`).join('')}</select>
      <button type="button" class="pm-icon-btn" data-proposal-refresh aria-label="Refresh proposals">↻</button>
    </div>
  </div>`;
}

function proposalCard(proposal, fallbackStatus = 'pending') {
  const id = String(proposal.id || '');
  const status = String(proposal.status || fallbackStatus).toLowerCase();
  const pending = status === 'pending';
  const executing = ['executing', 'repairing'].includes(status);
  const result = String(proposal.executionResult || '').trim();
  const created = dateTime(proposal.createdAt);
  const decided = proposal.decidedAt ? dateTime(proposal.decidedAt) : '';
  const executor = String(proposal.executorAgentId || proposal.executorProvider || 'main');
  return `<article class="pm-card pm-proposal-card" data-proposal-card="${escapeHtml(id)}">
    <div class="pm-proposal-head">
      <span class="pm-more-icon">${ICONS.doc}</span>
      <div>
        <strong>${escapeHtml(proposal.title || proposal.name || 'Untitled proposal')}</strong>
        <div class="pm-proposal-badges">${priorityBadge(proposal)}${statusBadge({ ...proposal, status })}<span>${escapeHtml(proposal.type || 'proposal')}</span></div>
      </div>
      <button type="button" class="pm-icon-btn" data-open-proposal="${escapeHtml(id)}" aria-label="Open proposal details">${ICONS.dots}</button>
    </div>
    <p>${escapeHtml(proposal.summary || proposal.description || '')}</p>
    ${proposalFiles(proposal)}
    ${proposal.estimatedImpact ? `<p class="pm-proposal-impact">Impact: ${escapeHtml(proposal.estimatedImpact)}</p>` : ''}
    ${result && ['executed', 'failed'].includes(status) ? `<p class="pm-proposal-result">${escapeHtml(result.slice(0, 240))}${result.length > 240 ? '…' : ''}</p>` : ''}
    <div class="pm-more-meta-row"><span>Submitted: ${escapeHtml(created)}${decided ? ` · Decided: ${escapeHtml(decided)}` : ''}</span><span>${escapeHtml(executor)}</span></div>
    ${proposal.requiresBuild ? '<small class="pm-proposal-requires-build">Requires build</small>' : ''}
    ${proposal.executorTaskId && executing ? `<div class="pm-proposal-task-ref">Task: <code>${escapeHtml(proposal.executorTaskId)}</code></div>` : ''}
    <div class="pm-proposal-actions">
      ${pending ? `<button type="button" class="pm-btn success pm-proposal-action-btn" data-proposal-action="approve" data-id="${escapeHtml(id)}">Approve</button><button type="button" class="pm-btn danger pm-proposal-action-btn" data-proposal-action="deny" data-id="${escapeHtml(id)}">Deny</button>` : ''}
      ${proposal.executorTaskId && executing ? `<button type="button" class="pm-btn ghost" data-open-task="${escapeHtml(proposal.executorTaskId)}">View Task</button>` : ''}
      <button type="button" class="pm-btn ghost" data-open-proposal="${escapeHtml(id)}">View details &amp; plan</button>
    </div>
  </article>`;
}

function detailBody(proposal) {
  const status = String(proposal.status || 'pending').toLowerCase();
  const pending = status === 'pending';
  const detailValue = proposal.details ?? proposal.payload;
  const detailText = (typeof detailValue === 'string' ? detailValue : jsonText(detailValue)).trim();
  const diff = String(proposal.diffPreview || '').trim();
  const executing = ['executing', 'repairing'].includes(status);
  return `<section class="pm-card pm-proposal-review-card">
    <div class="pm-proposal-head"><span class="pm-more-icon">${ICONS.doc}</span><div><strong>${escapeHtml(proposal.title || proposal.name || 'Untitled proposal')}</strong><div class="pm-proposal-badges">${priorityBadge(proposal)}${statusBadge(proposal)}<span>${escapeHtml(proposal.type || 'proposal')}</span></div></div></div>
    <p>${escapeHtml(proposal.summary || proposal.description || '')}</p>
    ${proposalFiles(proposal, 4)}
    ${proposal.estimatedImpact ? `<p class="pm-proposal-impact">Impact: ${escapeHtml(proposal.estimatedImpact)}</p>` : ''}
    ${proposal.requiresBuild ? '<small class="pm-proposal-requires-build">Requires build</small>' : ''}
    <div class="pm-more-meta-row"><span>Submitted: ${escapeHtml(dateTime(proposal.createdAt))}</span><span>${escapeHtml(proposal.executorAgentId || 'main')}</span></div>
    ${proposal.executorTaskId && executing ? `<div class="pm-proposal-actions"><button type="button" class="pm-btn ghost" data-open-task="${escapeHtml(proposal.executorTaskId)}">View Task</button></div>` : ''}
  </section>
  ${proposalSteps(proposal)}
  ${detailText ? `<section class="pm-card pm-more-section pm-proposal-details"><div class="pm-card-head">Details</div><div class="markdown-body">${renderMd(detailText)}</div></section>` : ''}
  ${diff ? `<section class="pm-card pm-more-section pm-proposal-details"><div class="pm-card-head">Diff Preview</div><pre>${escapeHtml(diff)}</pre></section>` : ''}
  ${proposal.executionResult && ['executed', 'failed'].includes(status) ? `<section class="pm-card pm-more-section"><div class="pm-card-head">Execution Result</div><p>${escapeHtml(proposal.executionResult)}</p></section>` : ''}
  <div class="pm-proposal-review-actions">
    ${pending ? `<button type="button" class="pm-btn success" data-detail-action="approve">Approve</button><button type="button" class="pm-btn danger" data-detail-action="deny">Deny</button>` : '<button type="button" class="pm-btn ghost" data-proposal-back>Back to proposals</button>'}
  </div>`;
}

function showActionResult(shell, action, response) {
  if (response?.success === false) throw new Error(response.error || `${action} failed`);
  shell.showNotice(action === 'approve' ? 'Proposal approved' : 'Proposal denied');
}

export async function mountProposalsPage({ shell, features, route }) {
  shell.setActiveTab('chat');
  shell.setTitle('Proposals');
  const page = shell.page;
  let disposed = false;
  let filter = 'pending';
  let rows = [];

  async function list() {
    page.innerHTML = `${proposalHeader(filter)}${loading('Loading proposals…')}`;
    page.querySelector('[data-proposal-filter]')?.addEventListener('change', (event) => {
      filter = event.currentTarget.value;
      list();
    });
    page.querySelector('[data-proposal-refresh]')?.addEventListener('click', list);
    try {
      rows = await features.proposals(filter);
      if (disposed) return;
      page.innerHTML = `${proposalHeader(filter)}${rows.length
        ? `<div class="pm-proposals-page">${rows.map((proposal) => proposalCard(proposal, filter)).join('')}</div>`
        : `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.doc}</div><h2>${filter === 'pending' ? 'No pending proposals' : `No ${escapeHtml(FILTER_LABELS[filter] || filter.toLowerCase())} proposals`}</h2><p>Agent-generated proposals will appear here when they need review.</p></div>`}`;
      page.querySelector('[data-proposal-filter]')?.addEventListener('change', (event) => {
        filter = event.currentTarget.value;
        list();
      });
      page.querySelector('[data-proposal-refresh]')?.addEventListener('click', list);
      page.querySelectorAll('[data-open-proposal]').forEach((button) => button.addEventListener('click', (event) => {
        event.stopPropagation();
        detail(button.dataset.openProposal);
      }));
      page.querySelectorAll('[data-proposal-card]').forEach((card) => card.addEventListener('click', (event) => {
        if (event.target.closest('button, a, input, select, textarea')) return;
        detail(card.dataset.proposalCard);
      }));
      page.querySelectorAll('[data-open-task]').forEach((button) => button.addEventListener('click', (event) => {
        event.stopPropagation();
        shell.navigate?.(`tasks/${encodeURIComponent(button.dataset.openTask)}`);
      }));
      page.querySelectorAll('[data-proposal-action]').forEach((button) => button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const action = button.dataset.proposalAction;
        button.disabled = true;
        try {
          const response = await features.proposalAction(button.dataset.id, action);
          showActionResult(shell, action, response);
          list();
        } catch (error) {
          shell.showNotice(error?.message || 'Proposal action failed.');
          button.disabled = false;
        }
      }));
    } catch (error) {
      if (disposed) return;
      page.innerHTML = `${proposalHeader(filter)}${errorState(error)}`;
      page.querySelector('[data-proposal-filter]')?.addEventListener('change', (event) => { filter = event.currentTarget.value; list(); });
      page.querySelector('[data-proposal-refresh]')?.addEventListener('click', list);
      page.querySelector('[data-v2-retry]')?.addEventListener('click', list);
    }
  }

  async function detail(id) {
    page.innerHTML = `<div class="pm-v2-page-heading pm-proposal-detail-heading"><div><h1>Proposal Review</h1><p>Review the work and its execution plan.</p></div></div>${loading('Loading proposal…')}`;
    try {
      const response = await features.proposal(id);
      if (disposed) return;
      const proposal = response?.proposal || response || {};
      await ensureMobileV2Markdown();
      if (disposed) return;
      page.innerHTML = `<div class="pm-v2-page-heading pm-proposal-detail-heading"><div><h1>Proposal Review</h1><p>Review the work and its execution plan.</p></div></div><div class="pm-proposals-page">${detailBody(proposal)}</div>`;
      page.querySelectorAll('[data-detail-action]').forEach((button) => button.addEventListener('click', async (event) => {
        const action = event.currentTarget.dataset.detailAction;
        button.disabled = true;
        try {
          const result = await features.proposalAction(id, action);
          showActionResult(shell, action, result);
          detail(id);
        } catch (error) {
          shell.showNotice(error?.message || 'Proposal action failed.');
          button.disabled = false;
        }
      }));
      page.querySelector('[data-open-task]')?.addEventListener('click', (event) => {
        shell.navigate?.(`tasks/${encodeURIComponent(event.currentTarget.dataset.openTask)}`);
      });
      // Non-pending proposals render a "Back to proposals" button instead of
      // approve/deny. It had no handler, which stranded the user on the detail
      // view with no in-page way back to the list.
      page.querySelector('[data-proposal-back]')?.addEventListener('click', () => {
        list();
      });
    } catch (error) {
      if (disposed) return;
      page.innerHTML = `<div class="pm-v2-page-heading pm-proposal-detail-heading"><div><h1>Proposal Review</h1></div></div>${errorState(error)}`;
      page.querySelector('[data-v2-retry]')?.addEventListener('click', () => detail(id));
    }
  }

  if (route?.id) detail(route.id);
  else list();
  return () => { disposed = true; };
}
