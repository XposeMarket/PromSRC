import { escapeHtml, loading, emptyState, errorState, pageHeading, statusPill, relativeTime, card, normalizeText } from '../../ui/page-kit.js';

const FILTERS = ['all','running','queued','paused','waiting','completed','failed'];

function taskStatus(task) { return String(task?.status || task?.state || 'unknown').toLowerCase(); }
function taskTitle(task) { return String(task?.title || task?.name || task?.task || task?.prompt || task?.id || 'Background task'); }
function taskSummary(task) { return String(task?.summary || task?.description || task?.currentStep || task?.resumeContext?.summary || ''); }

function matchesFilter(task, filter) {
  const status = taskStatus(task);
  if (filter === 'all') return true;
  if (filter === 'waiting') return /waiting|needs_assistance|awaiting_user_input|waiting_subagent/.test(status);
  if (filter === 'completed') return /completed|succeeded/.test(status);
  return status.includes(filter);
}

function actionButtons(task) {
  const status = taskStatus(task);
  const rows = [];
  if (/running|queued/.test(status)) rows.push(['pause','Pause']);
  if (/paused|stalled|needs_assistance|awaiting_user_input|waiting_subagent/.test(status)) rows.push(['resume','Resume']);
  if (/failed|cancelled/.test(status)) rows.push(['retry','Retry']);
  if (!/completed|succeeded|cancelled/.test(status)) rows.push(['cancel','Cancel']);
  rows.push(['delete','Delete']);
  return rows.map(([id,label]) => `<button type="button" class="pm-btn ${id === 'delete' ? 'ghost danger' : 'ghost'}" data-task-action="${id}">${label}</button>`).join('');
}

export async function mountTasksPage({ shell, features, route }) {
  shell.setActiveTab('tasks');
  shell.setTitle(route?.id ? 'Task' : 'Tasks');
  let disposed = false;
  let filter = 'all';
  const page = shell.page;

  async function renderList() {
    page.innerHTML = `${pageHeading('Tasks','Background work across this gateway',`<button class="pm-btn ghost" data-tasks-refresh>Refresh</button>`)}${loading('Loading tasks…')}`;
    try {
      const tasks = await features.tasks();
      if (disposed) return;
      const paint = () => {
        const filtered = tasks.filter((task) => matchesFilter(task, filter));
        page.innerHTML = `${pageHeading('Tasks','Background work across this gateway',`<button class="pm-btn ghost" data-tasks-refresh>Refresh</button>`)}
          <div class="pm-v2-toolbar"><select class="pm-select" data-task-filter>${FILTERS.map((name) => `<option value="${name}"${name===filter?' selected':''}>${name[0].toUpperCase()+name.slice(1)}</option>`).join('')}</select><span>${filtered.length} task${filtered.length===1?'':'s'}</span></div>
          <div class="pm-v2-card-list">${filtered.length ? filtered.map((task) => card('',`<button type="button" class="pm-v2-card-link" data-task-id="${escapeHtml(task.id)}"><div class="pm-v2-row-between"><strong>${escapeHtml(taskTitle(task))}</strong>${statusPill(taskStatus(task))}</div>${taskSummary(task)?`<p>${escapeHtml(taskSummary(task))}</p>`:''}<small>${escapeHtml(relativeTime(task.updatedAt || task.finishedAt || task.startedAt || task.createdAt))}</small></button>`)).join('') : emptyState('No tasks in this filter','Try another status.')}</div>`;
        page.querySelector('[data-task-filter]')?.addEventListener('change',(event)=>{ filter=event.target.value; paint(); });
        page.querySelector('[data-tasks-refresh]')?.addEventListener('click',renderList);
        page.querySelectorAll('[data-task-id]').forEach((button)=>button.addEventListener('click',()=>shell.navigate?.(`tasks/${encodeURIComponent(button.dataset.taskId)}`)));
      };
      paint();
    } catch (error) {
      if (disposed) return;
      page.innerHTML = `${pageHeading('Tasks')}${errorState(error)}`;
      page.querySelector('[data-v2-retry]')?.addEventListener('click',renderList);
    }
  }

  async function renderDetail(id) {
    page.innerHTML = `${pageHeading('Task')}${loading('Loading task…')}`;
    try {
      const [response,evidence] = await Promise.all([features.task(id),features.taskEvidence(id)]);
      if (disposed) return;
      const task = response?.task || response || {};
      const status = taskStatus(task);
      const journal = Array.isArray(task.journal) ? task.journal : Array.isArray(task.events) ? task.events : [];
      page.innerHTML = `${pageHeading(taskTitle(task),task.id || '',`<button class="pm-btn ghost" data-task-back>Back</button>`)}
        ${card('',`<div class="pm-v2-row-between"><strong>Status</strong>${statusPill(status)}</div>${taskSummary(task)?`<p>${escapeHtml(taskSummary(task))}</p>`:''}<div class="pm-v2-actions">${actionButtons(task)}</div>`)}
        ${card('Task',`<div class="pm-v2-prose">${escapeHtml(String(task.task || task.prompt || task.description || 'No task prompt.'))}</div>`)}
        ${task.resumeContext ? card('Recovery context',`<pre class="pm-v2-pre">${escapeHtml(typeof task.resumeContext==='string'?task.resumeContext:JSON.stringify(task.resumeContext,null,2))}</pre>`) : ''}
        ${card('Message task',`<form data-task-message-form class="pm-v2-inline-form"><textarea class="pm-input" placeholder="Give this task more context…"></textarea><button class="pm-btn primary" type="submit">Send</button></form>`)}
        ${journal.length ? card('Activity',`<div class="pm-v2-event-list">${journal.slice(-30).reverse().map((event)=>`<div><strong>${escapeHtml(event.type || event.kind || 'Update')}</strong><span>${escapeHtml(normalizeText(event) || event.summary || '')}</span></div>`).join('')}</div>`) : ''}
        ${evidence.length ? card('Evidence',`<div class="pm-v2-event-list">${evidence.slice(-20).reverse().map((entry)=>`<div><strong>${escapeHtml(entry.type || entry.kind || 'Evidence')}</strong><span>${escapeHtml(normalizeText(entry) || entry.summary || entry.uri || '')}</span></div>`).join('')}</div>`) : ''}`;
      page.querySelector('[data-task-back]')?.addEventListener('click',()=>shell.navigate?.('tasks'));
      page.querySelectorAll('[data-task-action]').forEach((button)=>button.addEventListener('click',async()=>{
        button.disabled=true;
        try { await features.taskAction(id,button.dataset.taskAction); shell.showNotice(`${button.textContent} requested.`); if(button.dataset.taskAction==='delete') shell.navigate?.('tasks'); else renderDetail(id); }
        catch(error){ shell.showNotice(error?.message || 'Task action failed.'); button.disabled=false; }
      }));
      page.querySelector('[data-task-message-form]')?.addEventListener('submit',async(event)=>{
        event.preventDefault(); const input=event.currentTarget.querySelector('textarea'); const message=input.value.trim(); if(!message)return;
        try { await features.taskMessage(id,message); input.value=''; shell.showNotice('Message sent to task.'); renderDetail(id); } catch(error){ shell.showNotice(error?.message || 'Message failed.'); }
      });
    } catch (error) {
      if (disposed) return;
      page.innerHTML = `${pageHeading('Task')}${errorState(error)}`;
      page.querySelector('[data-v2-retry]')?.addEventListener('click',()=>renderDetail(id));
    }
  }

  if (route?.id) renderDetail(route.id); else renderList();
  return () => { disposed = true; };
}
