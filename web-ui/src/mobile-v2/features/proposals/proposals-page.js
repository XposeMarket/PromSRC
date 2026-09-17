import { escapeHtml, loading, emptyState, errorState, pageHeading, statusPill, card, asTime, safeJson } from '../../ui/page-kit.js';

const FILTERS=['pending','executing','approved','denied','executed','all'];

export async function mountProposalsPage({ shell, features, route }) {
  shell.setActiveTab('chat'); shell.setTitle('Proposals');
  const page=shell.page; let disposed=false; let filter='pending';

  async function list(){
    page.innerHTML=`${pageHeading('Proposals','Review and approve agent work')}${loading('Loading proposals…')}`;
    try{
      const rows=await features.proposals(filter); if(disposed)return;
      page.innerHTML=`${pageHeading('Proposals','Review and approve agent work',`<select class="pm-select" data-proposal-filter>${FILTERS.map((item)=>`<option ${item===filter?'selected':''} value="${item}">${item}</option>`).join('')}</select>`)}<div class="pm-v2-card-list">${rows.length?rows.map((proposal)=>card('',`<button class="pm-v2-card-link" data-proposal-id="${escapeHtml(proposal.id)}"><div class="pm-v2-row-between"><strong>${escapeHtml(proposal.title||proposal.name||'Proposal')}</strong>${statusPill(proposal.status||filter)}</div><p>${escapeHtml(proposal.summary||proposal.description||'')}</p><small>${escapeHtml(proposal.priority||proposal.type||'')} ${proposal.createdAt?`• ${escapeHtml(asTime(proposal.createdAt))}`:''}</small></button>${String(proposal.status||filter)==='pending'?`<div class="pm-v2-actions"><button class="pm-btn primary" data-proposal-action="approve" data-id="${escapeHtml(proposal.id)}">Approve</button><button class="pm-btn ghost danger" data-proposal-action="deny" data-id="${escapeHtml(proposal.id)}">Deny</button></div>`:''}`)).join(''):emptyState('No proposals','Nothing in this filter.')}</div>`;
      page.querySelector('[data-proposal-filter]')?.addEventListener('change',(event)=>{filter=event.target.value;list();});
      page.querySelectorAll('[data-proposal-id]').forEach((button)=>button.addEventListener('click',()=>detail(button.dataset.proposalId)));
      page.querySelectorAll('[data-proposal-action]').forEach((button)=>button.addEventListener('click',async()=>{ try{ await features.proposalAction(button.dataset.id,button.dataset.proposalAction); shell.showNotice(`Proposal ${button.dataset.proposalAction}d.`); list(); }catch(error){shell.showNotice(error?.message||'Proposal action failed.');} }));
    }catch(error){if(disposed)return;page.innerHTML=`${pageHeading('Proposals')}${errorState(error)}`;page.querySelector('[data-v2-retry]')?.addEventListener('click',list);}
  }

  async function detail(id){
    page.innerHTML=`${pageHeading('Proposal')}${loading('Loading proposal…')}`;
    try{
      const response=await features.proposal(id); if(disposed)return; const proposal=response?.proposal||response||{}; const steps=proposal.steps||proposal.plan||proposal.executionSteps||[]; const files=proposal.files||proposal.affectedFiles||[];
      page.innerHTML=`${pageHeading(proposal.title||proposal.name||'Proposal','',`<button class="pm-btn ghost" data-proposal-back>Back</button>`)}${card('',`<div class="pm-v2-row-between">${statusPill(proposal.status||'pending')}<span class="pm-v2-muted">${escapeHtml(proposal.priority||proposal.type||'')}</span></div><p>${escapeHtml(proposal.summary||proposal.description||'')}</p><div class="pm-v2-actions">${proposal.status==='pending'||!proposal.status?`<button class="pm-btn primary" data-detail-action="approve">Approve</button><button class="pm-btn ghost danger" data-detail-action="deny">Deny</button>`:''}</div>`)}${Array.isArray(files)&&files.length?card('Affected files',`<div class="pm-v2-chip-list">${files.map((file)=>`<span>${escapeHtml(typeof file==='string'?file:file.path||file.name||'file')}</span>`).join('')}</div>`):''}${Array.isArray(steps)&&steps.length?card('Execution plan',`<ol class="pm-v2-step-list">${steps.map((step)=>`<li>${escapeHtml(typeof step==='string'?step:step.title||step.description||safeJson(step))}</li>`).join('')}</ol>`):''}${proposal.details||proposal.payload?card('Details',`<pre class="pm-v2-pre">${escapeHtml(typeof (proposal.details||proposal.payload)==='string'?(proposal.details||proposal.payload):safeJson(proposal.details||proposal.payload))}</pre>`):''}`;
      page.querySelector('[data-proposal-back]')?.addEventListener('click',list);
      page.querySelectorAll('[data-detail-action]').forEach((button)=>button.addEventListener('click',async()=>{try{await features.proposalAction(id,button.dataset.detailAction);shell.showNotice(`Proposal ${button.dataset.detailAction}d.`);detail(id);}catch(error){shell.showNotice(error?.message||'Action failed.');}}));
    }catch(error){page.innerHTML=`${pageHeading('Proposal')}${errorState(error)}`;}
  }

  if(route?.id) detail(route.id); else list();
  return ()=>{disposed=true;};
}
