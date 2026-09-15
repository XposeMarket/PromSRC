import { escapeHtml, loading, errorState, pageHeading, card, statusPill, asTime } from '../../ui/page-kit.js';

function metric(value,fallback='—'){ return value==null||value===''?fallback:String(value); }

export async function mountHubPage({ shell, features, route }) {
  shell.setActiveTab(route?.name==='hub'?'hub':'chat'); shell.setTitle(route?.name==='hub'?'Hub':(route?.name||'More'));
  const page=shell.page; let disposed=false;

  async function overview(){
    page.innerHTML=`${pageHeading('Hub','Prometheus at a glance')}${loading('Loading Hub…')}`;
    try{
      const data=await features.hubOverview(); if(disposed)return; const models=data.models?.models||data.models||{}; const tools=data.tools?.tools||data.tools||{};
      const modelRows=Array.isArray(models)?models:[]; const toolRows=Array.isArray(tools)?tools:[];
      page.innerHTML=`${pageHeading('Hub','Prometheus at a glance',`<button class="pm-btn ghost" data-hub-refresh>Refresh</button>`)}<div class="pm-v2-metric-grid"><div><strong>${escapeHtml(metric(data.models?.totalCalls||data.models?.calls||modelRows.length))}</strong><span>Model calls</span></div><div><strong>${escapeHtml(metric(data.tools?.totalCalls||data.tools?.calls||toolRows.length))}</strong><span>Tool calls</span></div><div><strong>${data.goals.length}</strong><span>Goals</span></div><div><strong>${escapeHtml(metric(data.models?.tokens?.total||data.models?.totalTokens))}</strong><span>Tokens</span></div></div>
        ${card('Models',modelRows.length?`<div class="pm-v2-event-list">${modelRows.slice(0,8).map((row)=>`<div><strong>${escapeHtml(row.model||row.name||row.id||'Model')}</strong><span>${escapeHtml(metric(row.calls||row.count||row.tokens,''))}</span></div>`).join('')}</div>`:'<p class="pm-v2-muted">Model analytics are available when the gateway has usage data.</p>')}
        ${card('Goals',data.goals.length?`<div class="pm-v2-event-list">${data.goals.slice(0,8).map((goal)=>`<button data-goal-id="${escapeHtml(goal.id||'')}"><strong>${escapeHtml(goal.title||goal.name||goal.goal||'Goal')}</strong><span>${escapeHtml(goal.status||goal.progress||'')}</span></button>`).join('')}</div>`:'<p class="pm-v2-muted">No goals yet.</p>')}
        <div class="pm-v2-menu-grid"><button data-hub-route="memory">Memory</button><button data-hub-route="audit">Audit</button><button data-hub-route="gateways">Connections</button><button data-hub-route="settings">Settings</button></div>`;
      page.querySelector('[data-hub-refresh]')?.addEventListener('click',overview);
      page.querySelectorAll('[data-hub-route]').forEach((button)=>button.addEventListener('click',()=>shell.navigate?.(button.dataset.hubRoute)));
    }catch(error){page.innerHTML=`${pageHeading('Hub')}${errorState(error)}`;page.querySelector('[data-v2-retry]')?.addEventListener('click',overview);}
  }

  async function audit(){
    page.innerHTML=`${pageHeading('Audit','Recent non-main activity',`<button class="pm-btn ghost" data-back-hub>Back</button>`)}${loading('Loading audit…')}`;
    const response=await features.audit().catch((error)=>({error})); if(disposed)return; if(response.error){page.innerHTML+=errorState(response.error);return;}
    const rows=response.runs||response.entries||response.items||[];
    page.innerHTML=`${pageHeading('Audit','Recent non-main activity',`<button class="pm-btn ghost" data-back-hub>Back</button>`)}${card('',rows.length?`<div class="pm-v2-event-list">${rows.slice(0,80).map((row)=>`<div><strong>${escapeHtml(row.action||row.type||row.event||'Activity')}</strong><span>${escapeHtml(row.summary||row.message||row.actor||'')} ${row.createdAt?`• ${escapeHtml(asTime(row.createdAt))}`:''}</span></div>`).join('')}</div>`:'<p class="pm-v2-muted">No recent audit entries.</p>')}`;
    page.querySelector('[data-back-hub]')?.addEventListener('click',()=>shell.navigate?.('hub'));
  }

  async function memory(){
    page.innerHTML=`${pageHeading('Memory','Recent associative memory',`<button class="pm-btn ghost" data-back-hub>Back</button>`)}${loading('Loading memory…')}`;
    const graph=await features.memory().catch((error)=>({error})); if(disposed)return; if(graph.error){page.innerHTML+=errorState(graph.error);return;}
    const nodes=graph.nodes||graph.items||[];
    page.innerHTML=`${pageHeading('Memory','Recent associative memory',`<button class="pm-btn ghost" data-back-hub>Back</button>`)}<div class="pm-v2-metric-grid"><div><strong>${nodes.length}</strong><span>Nodes</span></div><div><strong>${(graph.edges||[]).length}</strong><span>Links</span></div></div>${card('Recent',nodes.length?`<div class="pm-v2-event-list">${nodes.slice(-40).reverse().map((node)=>`<div><strong>${escapeHtml(node.title||node.type||node.id||'Memory')}</strong><span>${escapeHtml(node.summary||node.text||node.content||'')}</span></div>`).join('')}</div>`:'<p class="pm-v2-muted">No memory graph entries were returned.</p>')}`;
    page.querySelector('[data-back-hub]')?.addEventListener('click',()=>shell.navigate?.('hub'));
  }

  if(route?.name==='audit') audit(); else if(route?.name==='memory') memory(); else overview();
  return ()=>{disposed=true;};
}
