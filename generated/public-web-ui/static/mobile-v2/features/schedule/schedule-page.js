import { escapeHtml, loading, emptyState, errorState, pageHeading, statusPill, card, field } from '../../ui/page-kit.js';

function patternLabel(item) { return String(item.pattern || item.schedule || item.cron || item.raw?.pattern || (item.kind==='brain'?'Built in':'Manual')); }

export async function mountSchedulePage({ shell, features, route }) {
  shell.setActiveTab('chat');
  shell.setTitle(route?.id ? 'Schedule' : 'Schedule');
  const page = shell.page;
  let disposed = false;

  async function list() {
    page.innerHTML = `${pageHeading('Schedule','Automations and Brain routines',`<button class="pm-btn primary" data-new-schedule>New</button><button class="pm-btn ghost" data-refresh>Refresh</button>`)}${loading('Loading schedules…')}`;
    try {
      const rows = await features.schedules();
      if (disposed) return;
      page.innerHTML = `${pageHeading('Schedule','Automations and Brain routines',`<button class="pm-btn primary" data-new-schedule>New</button><button class="pm-btn ghost" data-refresh>Refresh</button>`)}<div class="pm-v2-card-list">${rows.length ? rows.map((item)=>card('',`<div class="pm-v2-row-between"><button class="pm-v2-title-button" data-schedule-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(patternLabel(item))}</small></button>${statusPill(item.enabled?'active':'disabled',item.enabled?'Active':'Off')}</div><div class="pm-v2-actions"><button class="pm-btn ghost" data-schedule-run="${escapeHtml(item.id)}">Run now</button><button class="pm-switch${item.enabled?' on':''}" type="button" role="switch" aria-checked="${item.enabled?'true':'false'}" data-schedule-toggle="${escapeHtml(item.id)}"><span></span></button></div>`)).join('') : emptyState('No schedules','Create one from your phone.')}</div>`;
      page.querySelector('[data-refresh]')?.addEventListener('click',list);
      page.querySelector('[data-new-schedule]')?.addEventListener('click',()=>editor(null));
      page.querySelectorAll('[data-schedule-id]').forEach((button)=>button.addEventListener('click',()=>editor(rows.find((row)=>row.id===button.dataset.scheduleId))));
      page.querySelectorAll('[data-schedule-run]').forEach((button)=>button.addEventListener('click',async()=>{ const item=rows.find((row)=>row.id===button.dataset.scheduleRun); try { await features.runSchedule(item); shell.showNotice(`${item.name} started.`); } catch(error){ shell.showNotice(error?.message||'Run failed.'); } }));
      page.querySelectorAll('[data-schedule-toggle]').forEach((button)=>button.addEventListener('click',async()=>{ const item=rows.find((row)=>row.id===button.dataset.scheduleToggle); try { await features.toggleSchedule(item,!item.enabled); list(); } catch(error){ shell.showNotice(error?.message||'Update failed.'); } }));
    } catch(error){ if(disposed)return; page.innerHTML=`${pageHeading('Schedule')}${errorState(error)}`; page.querySelector('[data-v2-retry]')?.addEventListener('click',list); }
  }

  async function editor(item) {
    const builtin = item?.kind === 'brain';
    page.innerHTML = `${pageHeading(item ? 'Edit Schedule' : 'New Schedule','',`<button class="pm-btn ghost" data-schedule-back>Back</button>`)}
      <form class="pm-v2-form" data-schedule-form>
        ${field('Name',item?.name || '','text','name="name" required')}
        ${field('Prompt',item?.prompt || item?.raw?.prompt || '','textarea','name="prompt" rows="7"')}
        ${field('Schedule / cron',patternLabel(item || {}),'text','name="pattern" placeholder="0 8 * * 1-5"')}
        <label class="pm-v2-field"><span>Timezone</span><input name="timezone" value="${escapeHtml(item?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || '')}"/></label>
        <label class="pm-v2-check"><input type="checkbox" name="enabled" ${item?.enabled!==false?'checked':''}/><span>Enabled</span></label>
        <div class="pm-v2-actions"><button class="pm-btn primary" type="submit" ${builtin?'disabled':''}>${item?'Save changes':'Create schedule'}</button>${item && !builtin?'<button class="pm-btn ghost danger" type="button" data-schedule-delete>Delete</button>':''}${builtin?'<span class="pm-v2-muted">Brain schedules keep their built-in timing; use the list toggle/run controls.</span>':''}</div>
      </form>`;
    page.querySelector('[data-schedule-back]')?.addEventListener('click',list);
    page.querySelector('[data-schedule-form]')?.addEventListener('submit',async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget); const fields={ name:String(form.get('name')||'').trim(), prompt:String(form.get('prompt')||''), pattern:String(form.get('pattern')||''), timezone:String(form.get('timezone')||''), delivery_channel:'web', enabled:form.get('enabled')==='on', confirm:true };
      try { if(item) await features.updateSchedule(item,fields); else await features.createSchedule(fields); shell.showNotice(item?'Schedule saved.':'Schedule created.'); list(); } catch(error){ shell.showNotice(error?.message||'Schedule save failed.'); }
    });
    page.querySelector('[data-schedule-delete]')?.addEventListener('click',async()=>{ if(!confirm(`Delete ${item.name}?`)) return; try { await features.deleteSchedule(item); shell.showNotice('Schedule deleted.'); list(); } catch(error){ shell.showNotice(error?.message||'Delete failed.'); } });
  }

  if(route?.id){ const rows=await features.schedules().catch(()=>[]); editor(rows.find((row)=>row.id===route.id)||null); } else list();
  return ()=>{ disposed=true; };
}
