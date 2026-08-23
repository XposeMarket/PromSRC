// Proposals route owner. Loaded only when its route or a shared dependent feature is requested.
import {
  ICONS,
  _wireMobileProcessRunActions,
  approveMobileProposal,
  denyMobileProposal,
  escapeHtml,
  loadMobileProposal,
  loadMobileProposals,
  pmToast,
  renderMobileHeader,
  wireHeaderActions,
} from './mobile-pages.js';

import {
  _pmDateTime,
  _pmMoreSkeleton,
  _pmProposalDetails,
  _pmProposalFiles,
  _pmProposalPriority,
  _pmProposalStatus,
  _pmProposalSteps,
} from './mobile-hub-pages.js';

/* ---------------- PROPOSALS PAGE ---------------- */

export async function renderProposalsPage(page, { proposalId = '', navigate }) {
  if (proposalId) return _renderProposalReview(page, { proposalId, navigate });

  const extras = `<span class="pm-spacer"></span><select id="pm-proposals-filter" class="pm-select"><option value="pending">Pending</option><option value="executing">In progress</option><option value="approved">Approved</option><option value="denied">Denied</option><option value="executed">Executed</option><option value="all">All</option></select><button class="pm-icon-btn" id="pm-proposals-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Proposals', online: true, extras, hideTitle: true, hideBrand: true })}
    <div class="pm-body pm-proposals-page" id="pm-proposals-body">${_pmMoreSkeleton()}</div>
  `;
  wireHeaderActions(page, {});
  const body = page.querySelector('#pm-proposals-body');
  const filterEl = page.querySelector('#pm-proposals-filter');
  let proposals = [];

  const paint = () => {
    const proposalHtml = proposals.length ? proposals.map((proposal) => {
      const isPending = String(proposal.status || '').toLowerCase() === 'pending';
      return `<article class="pm-card pm-proposal-card" data-proposal-id="${escapeHtml(proposal.id)}">
        <div class="pm-proposal-head">
          <span class="pm-more-icon">${ICONS.doc}</span>
          <div>
            <strong>${escapeHtml(proposal.title || 'Untitled proposal')}</strong>
            <div class="pm-proposal-badges">${_pmProposalPriority(proposal)}${_pmProposalStatus(proposal)}<span>${escapeHtml(proposal.type || 'proposal')}</span></div>
          </div>
          <button class="pm-icon-btn" data-open-proposal="${escapeHtml(proposal.id)}" aria-label="Open proposal">${ICONS.dots}</button>
        </div>
        <p>${escapeHtml(proposal.summary || '')}</p>
        ${_pmProposalFiles(proposal)}
        ${proposal.estimatedImpact ? `<p class="pm-proposal-impact">Impact: ${escapeHtml(proposal.estimatedImpact)}</p>` : ''}
        <div class="pm-more-meta-row"><span>Submitted: ${escapeHtml(_pmDateTime(proposal.createdAt))}</span><span>${escapeHtml(proposal.executorAgentId || 'main')}</span></div>
        <div class="pm-proposal-actions">
          ${isPending ? `<button class="pm-btn success pm-proposal-action-btn" data-approve-proposal="${escapeHtml(proposal.id)}">Approve</button><button class="pm-btn danger pm-proposal-action-btn" data-deny-proposal="${escapeHtml(proposal.id)}">Deny</button>` : ''}
          <button class="pm-btn ghost" data-open-proposal="${escapeHtml(proposal.id)}">View details & plan</button>
        </div>
      </article>`;
    }).join('') : '';
    body.innerHTML = proposalHtml
      ? proposalHtml
      : `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.doc}</div><h2>No proposals here</h2><p>Agent-generated proposals will appear here when they need review.</p></div>`;
    wireProposalList();
  };

  const load = async () => {
    try {
      body.innerHTML = _pmMoreSkeleton();
      const status = filterEl?.value || 'pending';
      proposals = await loadMobileProposals(status);
      paint();
    } catch (err) {
      body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.doc}</div><h2>Could not load proposals</h2><p>${escapeHtml(err.message || '')}</p></div>`;
    }
  };

  const act = async (id, kind, btn) => {
    if (!id) return;
    btn.disabled = true;
    try {
      const r = kind === 'approve' ? await approveMobileProposal(id) : await denyMobileProposal(id);
      if (!r || r.success === false) throw new Error(r?.error || `${kind} failed`);
      pmToast(kind === 'approve' ? 'Proposal approved' : 'Proposal denied', 'success');
      await load();
    } catch (err) {
      pmToast(err.message || 'Action failed', 'error');
    } finally {
      btn.disabled = false;
    }
  };

  function wireProposalList() {
    body.querySelectorAll('[data-open-proposal]').forEach((btn) => btn.addEventListener('click', (event) => {
      event.stopPropagation();
      navigate(`#mobile/proposals/${encodeURIComponent(btn.getAttribute('data-open-proposal') || '')}`);
    }));
    body.querySelectorAll('[data-proposal-id]').forEach((card) => card.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      navigate(`#mobile/proposals/${encodeURIComponent(card.getAttribute('data-proposal-id') || '')}`);
    }));
    body.querySelectorAll('[data-approve-proposal]').forEach((btn) => btn.addEventListener('click', (event) => {
      event.stopPropagation();
      act(btn.getAttribute('data-approve-proposal'), 'approve', btn);
    }));
    body.querySelectorAll('[data-deny-proposal]').forEach((btn) => btn.addEventListener('click', (event) => {
      event.stopPropagation();
      act(btn.getAttribute('data-deny-proposal'), 'deny', btn);
    }));
    _wireMobileProcessRunActions(body);
  }

  filterEl?.addEventListener('change', load);
  page.querySelector('#pm-proposals-refresh')?.addEventListener('click', load);
  await load();
}

async function _renderProposalReview(page, { proposalId, navigate }) {
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Proposal Review', leftIcon: 'back', onBack: () => navigate('#mobile/proposals'), online: false, hideTitle: true, hideBrand: true })}
    <div class="pm-body pm-proposals-page pm-proposal-review-body" id="pm-proposal-review-body">${_pmMoreSkeleton()}</div>
  `;
  wireHeaderActions(page, { onBack: () => navigate('#mobile/proposals') });
  const body = page.querySelector('#pm-proposal-review-body');
  try {
    const r = await loadMobileProposal(proposalId);
    const proposal = r?.proposal || r;
    const isPending = String(proposal?.status || '').toLowerCase() === 'pending';
    body.innerHTML = `
      <section class="pm-card pm-proposal-review-card">
        <div class="pm-proposal-head">
          <span class="pm-more-icon">${ICONS.doc}</span>
          <div>
            <strong>${escapeHtml(proposal.title || 'Untitled proposal')}</strong>
            <div class="pm-proposal-badges">${_pmProposalPriority(proposal)}${_pmProposalStatus(proposal)}<span>${escapeHtml(proposal.type || 'proposal')}</span></div>
          </div>
        </div>
        <p>${escapeHtml(proposal.summary || '')}</p>
        ${_pmProposalFiles(proposal, 4)}
        ${proposal.estimatedImpact ? `<p class="pm-proposal-impact">Impact: ${escapeHtml(proposal.estimatedImpact)}</p>` : ''}
      </section>
      ${_pmProposalSteps(proposal)}
      ${_pmProposalDetails(proposal)}
      <div class="pm-proposal-review-actions">
        ${isPending ? `<button class="pm-btn success" id="pm-proposal-approve">Approve</button><button class="pm-btn danger" id="pm-proposal-deny">Deny</button>` : `<button class="pm-btn ghost" id="pm-proposal-back">Back to proposals</button>`}
      </div>
    `;
    body.querySelector('#pm-proposal-back')?.addEventListener('click', () => navigate('#mobile/proposals'));
    body.querySelector('#pm-proposal-approve')?.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      try {
        const res = await approveMobileProposal(proposal.id);
        if (!res || res.success === false) throw new Error(res?.error || 'Approve failed');
        pmToast('Proposal approved', 'success');
        navigate('#mobile/proposals');
      } catch (err) {
        pmToast(err.message || 'Approve failed', 'error');
        btn.disabled = false;
      }
    });
    body.querySelector('#pm-proposal-deny')?.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      try {
        const res = await denyMobileProposal(proposal.id);
        if (!res || res.success === false) throw new Error(res?.error || 'Deny failed');
        pmToast('Proposal denied', 'success');
        navigate('#mobile/proposals');
      } catch (err) {
        pmToast(err.message || 'Deny failed', 'error');
        btn.disabled = false;
      }
    });
  } catch (err) {
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.doc}</div><h2>Could not load proposal</h2><p>${escapeHtml(err.message || '')}</p></div>`;
  }
}
