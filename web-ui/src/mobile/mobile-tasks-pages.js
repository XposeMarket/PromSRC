// Tasks route owner. Loaded only when its route or a shared dependent feature is requested.
import {
  ICONS,
  _formatChatTime,
  _formatTimeAgo,
  _pmRenderTaskJournal,
  _renderMobileMarkdown,
  escapeHtml,
  getCachedMobilePageData,
  loadBgTaskDetail,
  loadBgTaskEvidence,
  loadBgTasks,
  pmToast,
  renderMobileHeader,
  runBgTaskAction,
  sendBgTaskMessage,
  wireHeaderActions,
} from './mobile-pages.js';

import {
  _formatDuration,
} from './mobile-teams-pages.js';

/* ---------------- TASKS PAGE ---------------- */

const TASK_PILL = {
  running:           { label: 'running',   cls: 'running' },
  queued:            { label: 'queued',    cls: 'orange' },
  paused:            { label: 'paused',    cls: 'gray' },
  stalled:           { label: 'stalled',   cls: 'orange' },
  needs_assistance:  { label: 'needs help',cls: 'orange' },
  awaiting_user_input:{ label: 'awaiting', cls: 'orange' },
  waiting_subagent:  { label: 'waiting',   cls: 'orange' },
  completed:         { label: 'complete',  cls: 'active' },
  succeeded:         { label: 'success',   cls: 'active' },
  failed:            { label: 'failed',    cls: 'orange' },
  cancelled:         { label: 'cancelled', cls: 'gray' },
};
const TASK_ACTIVE_STATUSES = new Set(['running','queued','paused','stalled','needs_assistance','awaiting_user_input','waiting_subagent']);

function _tasksSkeleton() {
  const block = `<div class="pm-card" style="opacity:.55"><div class="pm-card-head">${ICONS.clipboard} loading…</div><div class="pm-card-body" style="height:36px;background:rgba(0,0,0,.04);border-radius:6px;"></div></div>`;
  return block.repeat(3);
}

async function _renderTasksPageOld(page, { navigate }) {
  const extras = `<span class="pm-spacer"></span><span class="pm-count-pill" id="pm-tasks-count">…</span><button class="pm-icon-btn" id="pm-tasks-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Tasks', online: true, extras, hideTitle: true, hideBrand: true })}
    <div class="pm-body" id="pm-tasks-body">
      <div class="pm-tabs" id="pm-tasks-filter" style="margin-top:4px;">
        <button class="active" data-filter="active">Active</button>
        <button data-filter="all">All</button>
        <button data-filter="done">Done</button>
        <button data-filter="failed">Failed</button>
      </div>
      <div id="pm-tasks-list">${_tasksSkeleton()}</div>
    </div>
  `;
  wireHeaderActions(page, {});

  const listEl = page.querySelector('#pm-tasks-list');
  const countEl = page.querySelector('#pm-tasks-count');
  const filterEl = page.querySelector('#pm-tasks-filter');
  let allTasks = [];
  let currentFilter = 'active';

  function _paint() {
    let tasks = allTasks;
    if (currentFilter === 'active')      tasks = allTasks.filter(t => TASK_ACTIVE_STATUSES.has(String(t.status)));
    else if (currentFilter === 'done')   tasks = allTasks.filter(t => ['completed','succeeded'].includes(String(t.status)));
    else if (currentFilter === 'failed') tasks = allTasks.filter(t => ['failed','cancelled'].includes(String(t.status)));

    if (!tasks.length) {
      listEl.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clipboard}</div><h2>No tasks here</h2><p>Background tasks and agent runs will appear here.</p></div>`;
      return;
    }

    listEl.innerHTML = tasks.map(t => {
      const pill = TASK_PILL[String(t.status)] || { label: String(t.status || 'unknown'), cls: 'gray' };
      const started = t.startedAt || t.createdAt;
      const dur = t.finishedAt && t.startedAt ? _formatDuration(t.finishedAt - t.startedAt) : (t.startedAt ? _formatDuration(Date.now() - t.startedAt) : '');
      const summary = t.title || t.prompt || t.summary || t.detail || '';
      const progressItems = Array.isArray(t.runtimeProgress?.items) ? t.runtimeProgress.items : [];
      const currentStep = progressItems.find(it => String(it?.status) === 'in_progress')?.text || '';
      return `
        <article class="pm-card" style="padding:12px 14px;" data-task-id="${escapeHtml(String(t.id || ''))}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <strong style="flex:1;font-size:13px;line-height:1.3;">${escapeHtml(String(summary).slice(0, 140))}${String(summary).length > 140 ? '…' : ''}</strong>
            <span class="pm-pill ${pill.cls}">${pill.label}</span>
          </div>
          ${currentStep ? `<div class="pm-card-body" style="font-size:12px;color:var(--pm-text-soft);margin-bottom:4px;"><span style="color:var(--pm-orange);font-weight:700;">›</span> ${escapeHtml(currentStep.slice(0, 160))}</div>` : ''}
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--pm-muted);">
            <span>${escapeHtml(t.actor || t.source || 'task')} · ${progressItems.length} step${progressItems.length === 1 ? '' : 's'}</span>
            <span>${started ? _formatTimeAgo(started) : ''}${dur ? ' · ' + dur : ''}</span>
          </div>
        </article>
      `;
    }).join('');
  }

  filterEl.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      filterEl.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      currentFilter = b.getAttribute('data-filter');
      _paint();
    });
  });

  async function _load() {
    try {
      allTasks = await loadBgTasks();
      countEl.textContent = `${allTasks.length} task${allTasks.length === 1 ? '' : 's'}`;
      _paint();
    } catch (err) {
      listEl.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clipboard}</div><h2>Couldn’t load tasks</h2><p>${escapeHtml(err.message || '')}</p></div>`;
    }
  }
  page.querySelector('#pm-tasks-refresh').addEventListener('click', () => { listEl.innerHTML = _tasksSkeleton(); _load(); });
  await _load();
}

const PM_TASK_FILTERS = [
  { key: 'running', label: 'In Progress' },
  { key: 'complete', label: 'Completed' },
  { key: 'paused', label: 'Paused' },
  { key: 'needs_you', label: 'Needs You' },
  { key: 'failed', label: 'Failed' },
  { key: 'queued', label: 'Queued' },
];

function _pmTaskStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'completed' || s === 'done' || s === 'succeeded') return 'complete';
  if (s === 'awaiting_user_input') return 'needs_assistance';
  if (s === 'waiting_subagent' || s === 'in_progress') return 'running';
  if (s === 'cancelled') return 'failed';
  return s || 'queued';
}

function _pmTaskFilter(status) {
  const s = _pmTaskStatus(status);
  if (s === 'needs_assistance') return 'needs_you';
  if (s === 'stalled') return 'paused';
  if (['running', 'complete', 'paused', 'failed', 'queued'].includes(s)) return s;
  return 'queued';
}

function _pmTaskPill(status) {
  const normalized = _pmTaskStatus(status);
  return TASK_PILL[status] || TASK_PILL[normalized] || { label: normalized, cls: 'gray' };
}

function _pmTaskProgressItems(task) {
  const plan = Array.isArray(task?.plan) ? task.plan : [];
  if (plan.length) {
    const currentIndex = Number.isFinite(Number(task?.currentStepIndex)) ? Number(task.currentStepIndex) : -1;
    const taskStatus = String(task?.status || '').toLowerCase();
    return plan.map((step, idx) => {
      const raw = String(step?.status || 'pending').toLowerCase();
      let status = 'pending';
      if (raw === 'done' || raw === 'skipped') status = 'done';
      else if (raw === 'failed') status = 'failed';
      else if (raw === 'running' || (taskStatus === 'running' && idx === currentIndex)) status = 'in_progress';
      else if ((taskStatus === 'failed' || taskStatus === 'stalled' || taskStatus === 'needs_assistance') && idx === currentIndex) status = 'failed';
      return { text: step?.description || step?.text || step?.title || `Step ${idx + 1}`, status };
    });
  }
  const runtimeItems = Array.isArray(task?.runtimeProgress?.items) ? task.runtimeProgress.items : [];
  return runtimeItems.map((item, idx) => ({ text: item?.text || `Step ${idx + 1}`, status: item?.status || 'pending' }));
}

function _pmRenderTaskProgress(items) {
  if (!items.length) return `<div class="pm-card-body">No plan steps recorded yet.</div>`;
  return `<div style="display:flex;flex-direction:column;gap:8px;">${items.map((item, idx) => {
    const raw = String(item.status || 'pending').toLowerCase();
    const done = raw === 'done' || raw === 'skipped';
    const failed = raw === 'failed';
    const running = raw === 'running' || raw === 'in_progress';
    const color = failed ? '#d8473a' : done ? '#2fae66' : running ? '#0d4faf' : 'var(--pm-muted)';
    const mark = done ? 'OK' : failed ? '!' : String(idx + 1);
    return `<div style="display:grid;grid-template-columns:28px 1fr;gap:8px;align-items:start;">
      <span style="width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:${running ? '#eaf2ff' : done ? '#eaffe9' : failed ? '#fff0f0' : 'var(--pm-surface)'};border:1px solid var(--pm-border);color:${color};font-size:10px;font-weight:800;">${mark}</span>
      <span style="font-size:12px;line-height:1.45;color:var(--pm-text);">${escapeHtml(String(item.text || '').slice(0, 260))}</span>
    </div>`;
  }).join('')}</div>`;
}



function _pmRenderTaskRecovery(task) {
  const rawTurns = Array.isArray(task?.recoveryConversation) ? task.recoveryConversation.slice(-12) : [];
  const pending = task?.pendingClarificationQuestion ? String(task.pendingClarificationQuestion) : '';
  const pauseMessage = String(task?.pauseAnalysis?.message || '').trim();
  const recoveryKey = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[#*_`~>-]+/g, '')
    .trim()
    .toLowerCase();
  const pauseKey = recoveryKey(pauseMessage);
  const seenTurnKeys = new Set();
  const turns = rawTurns.filter((turn) => {
    const content = String(turn?.content || '').trim();
    const key = recoveryKey(content);
    if (!key || seenTurnKeys.has(key)) return false;
    seenTurnKeys.add(key);
    // pauseAnalysis.message is often also appended as Prometheus's latest
    // recovery-conversation turn. Render it once, in the primary plan card.
    if (pauseKey && (key === pauseKey || (key.length > 160 && pauseKey.includes(key)) || (pauseKey.length > 160 && key.includes(pauseKey)))) return false;
    return true;
  });
  const bits = [];
  if (pending) bits.push(`<div class="pm-card-body"><strong>Pending question:</strong> ${escapeHtml(pending)}</div>`);
  if (pauseMessage) bits.push(`<div class="pm-card-body pm-task-recovery-copy">
    <div class="pm-task-recovery-label">Recovery plan</div>
    <div class="markdown-body pm-task-markdown">${_renderMobileMarkdown(pauseMessage)}</div>
  </div>`);
  if (turns.length) {
    bits.push(`<div style="display:flex;flex-direction:column;gap:8px;">${turns.map(turn => {
      const isUser = turn?.role === 'user';
      return `<div class="pm-task-recovery-message ${isUser ? 'from-user' : 'from-prometheus'}" style="align-self:${isUser ? 'flex-end' : 'flex-start'};max-width:92%;">
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--pm-muted);margin-bottom:4px;">${escapeHtml(isUser ? 'You' : 'Prometheus')}</div>
        <div class="markdown-body pm-task-markdown pm-task-recovery-turn">${_renderMobileMarkdown(turn?.content || '')}</div>
      </div>`;
    }).join('')}</div>`);
  }
  return bits.join('') || `<div class="pm-card-body">No recovery messages yet.</div>`;
}

function _pmRenderTaskEvidence(entries) {
  if (!entries?.length) return `<div class="pm-card-body">No evidence bus entries yet.</div>`;
  return `<div class="pm-task-evidence-list">${entries.slice().reverse().map(entry => `<div class="pm-task-evidence-entry">
    <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;">
      <strong style="font-size:12px;">${escapeHtml(entry?.title || entry?.type || 'Evidence')}</strong>
      <span style="font-size:10px;color:var(--pm-muted);">${entry?.t || entry?.timestamp ? escapeHtml(_formatChatTime(entry.t || entry.timestamp)) : ''}</span>
    </div>
    <div style="font-size:12px;color:var(--pm-text-soft);white-space:pre-wrap;word-break:break-word;">${escapeHtml(entry?.content || entry?.summary || entry?.text || JSON.stringify(entry).slice(0, 700))}</div>
  </div>`).join('')}</div>`;
}

// Task prompts include the execution envelope (agent identity, workspace rules,
// tool instructions, context, constraints, and success criteria). That material
// is useful to the runtime, but it is not the message a person dispatched. New
// task records preserve that message in originalAssignment; extract it from the
// older envelope format only when that field is unavailable.
function _pmTaskDispatchedMessage(task) {
  const original = String(task?.originalAssignment || '').trim();
  if (original) return original;

  const prompt = String(task?.prompt || task?.title || '').trim();
  if (!prompt) return '';
  const messageMatch = prompt.match(/(?:^|\n)Message:\s*\n([\s\S]*?)(?=\n\n(?:CONTEXT DATA|CONSTRAINTS|SUCCESS CRITERIA|EVIDENCE BUS|PROCESS LOG):|$)/i);
  if (messageMatch?.[1]?.trim()) return messageMatch[1].trim();
  const taskMatch = prompt.match(/(?:^|\n)(?:YOUR TASK|TASK):\s*\n?([\s\S]*?)(?=\n\n(?:ADDITIONAL CONTEXT|CONTEXT DATA|CONSTRAINTS|SUCCESS CRITERIA|TOOL RULES|EVIDENCE BUS|PROCESS LOG):|$)/i);
  if (taskMatch?.[1]?.trim()) return taskMatch[1].trim();
  return prompt;
}

function _pmRenderTaskPromptDisclosure(task) {
  const prompt = _pmTaskDispatchedMessage(task);
  if (!prompt) return '';
  const compact = prompt.replace(/\s+/g, ' ').trim();
  const previewLimit = 96;
  const preview = compact.slice(0, previewLimit);
  return `<section class="pm-task-prompt-section">
    <details class="pm-task-prompt-disclosure">
      <summary>
        <span class="pm-task-prompt-title">Task Prompt</span>
        <span class="pm-task-prompt-preview">${escapeHtml(preview)}${compact.length > previewLimit ? '…' : ''}</span>
      </summary>
      <div class="pm-card-body pm-task-prompt-body">${escapeHtml(prompt)}</div>
    </details>
  </section>`;
}

function _pmTaskAction(task) {
  const s = String(task?.status || '').toLowerCase();
  if (s === 'running') return { action: 'pause', label: 'Pause' };
  if (['paused', 'queued', 'stalled', 'needs_assistance', 'awaiting_user_input'].includes(s)) return { action: 'resume', label: 'Resume' };
  if (s === 'failed') return { action: 'restart', label: 'Restart' };
  return null;
}

export async function renderTasksPage(page, { navigate, taskId = '' }) {
  const extras = `<span class="pm-spacer"></span><span class="pm-count-pill" id="pm-tasks-count">...</span><button class="pm-icon-btn" id="pm-tasks-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Tasks', online: true, extras, hideTitle: true, hideBrand: true })}
    <div class="pm-body" id="pm-tasks-body">
      <div class="pm-tabs" id="pm-tasks-filter" style="margin-top:4px;overflow-x:auto;justify-content:flex-start;">
        ${PM_TASK_FILTERS.map((f, i) => `<button class="${i === 0 ? 'active' : ''}" data-filter="${f.key}">${escapeHtml(f.label)} <span data-count="${f.key}"></span></button>`).join('')}
      </div>
      <div id="pm-tasks-list">${_tasksSkeleton()}</div>
    </div>
  `;
  wireHeaderActions(page, {});

  const listEl = page.querySelector('#pm-tasks-list');
  const countEl = page.querySelector('#pm-tasks-count');
  const filterEl = page.querySelector('#pm-tasks-filter');
  let allTasks = [];
  let currentFilter = 'running';
  let expandedId = String(taskId || '').trim();
  let details = {};
  let evidence = {};
  let refreshTimer = null;

  function paint() {
    const bodyEl = page.querySelector('#pm-tasks-body');
    const bodySnapshot = bodyEl ? {
      top: bodyEl.scrollTop || 0,
      distanceFromBottom: Math.max(0, bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight),
    } : null;
    const journalEl = listEl.querySelector('[data-pm-task-journal]');
    const journalSnapshot = journalEl ? {
      scrollTop: journalEl.scrollTop || 0,
      distanceFromBottom: Math.max(0, journalEl.scrollHeight - journalEl.scrollTop - journalEl.clientHeight),
      nearBottom: (journalEl.scrollHeight - journalEl.scrollTop - journalEl.clientHeight) < 48,
    } : null;
    const counts = PM_TASK_FILTERS.reduce((acc, f) => { acc[f.key] = 0; return acc; }, {});
    for (const t of allTasks) counts[_pmTaskFilter(t.status)] = (counts[_pmTaskFilter(t.status)] || 0) + 1;
    for (const f of PM_TASK_FILTERS) {
      const el = filterEl.querySelector(`[data-count="${f.key}"]`);
      if (el) el.textContent = counts[f.key] ? `(${counts[f.key]})` : '';
    }

    const tasks = allTasks.filter(t => _pmTaskFilter(t.status) === currentFilter);
    if (!tasks.length) {
      listEl.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clipboard}</div><h2>No tasks here</h2><p>Background tasks and agent runs will appear here.</p></div>`;
      return;
    }

    listEl.innerHTML = tasks.map(t => {
      const id = String(t.id || '');
      const pill = _pmTaskPill(String(t.status || ''));
      const started = t.startedAt || t.createdAt;
      const finishedAt = t.completedAt || t.finishedAt;
      const dur = finishedAt && t.startedAt ? _formatDuration(finishedAt - t.startedAt) : (t.startedAt ? _formatDuration(Date.now() - t.startedAt) : '');
      const summary = t.title || t.prompt || t.summary || t.detail || '';
      const progressItems = _pmTaskProgressItems(t);
      const currentStep = progressItems.find(it => String(it?.status) === 'in_progress')?.text || '';
      const isOpen = id === expandedId;
      const detail = details[id]?.task;
      const detailEvidence = evidence[id] || details[id]?.evidenceBus?.entries || [];
      const action = _pmTaskAction(detail || t);
      return `
        <article class="pm-card pm-task-card" style="padding:12px 14px;cursor:pointer;" data-task-id="${escapeHtml(id)}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <strong style="flex:1;font-size:13px;line-height:1.3;">${escapeHtml(String(summary).slice(0, 140))}${String(summary).length > 140 ? '...' : ''}</strong>
            <span class="pm-pill ${pill.cls}">${escapeHtml(pill.label)}</span>
          </div>
          ${currentStep ? `<div class="pm-card-body" style="font-size:12px;color:var(--pm-text-soft);margin-bottom:4px;"><span style="color:var(--pm-orange);font-weight:700;">&gt;</span> ${escapeHtml(String(currentStep).slice(0, 160))}</div>` : ''}
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--pm-muted);gap:10px;">
            <span>${escapeHtml(t.actor || t.source || 'task')} - ${progressItems.length} step${progressItems.length === 1 ? '' : 's'}</span>
            <span>${started ? _formatTimeAgo(started) : ''}${dur ? ' - ' + dur : ''}</span>
          </div>
          ${isOpen ? `<div class="pm-task-expanded" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--pm-border);display:flex;flex-direction:column;gap:12px;cursor:default;">
            ${!detail ? `<div class="pm-card-body">Loading task details...</div>` : `
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                ${action ? `<button class="pm-btn ghost" data-task-action="${action.action}" data-task-id="${escapeHtml(id)}">${escapeHtml(action.label)}</button>` : ''}
                ${['failed','complete'].includes(_pmTaskFilter(detail.status)) ? `<button class="pm-btn ghost danger" data-task-action="delete" data-task-id="${escapeHtml(id)}">${ICONS.trash} Remove</button>` : ''}
              </div>
              ${detail.finalSummary ? `<section><div class="pm-card-head">Final Response</div><div class="pm-card-body pm-task-final-response markdown-body pm-task-markdown">${_renderMobileMarkdown(detail.finalSummary)}</div></section>` : ''}
              ${['needs_assistance','awaiting_user_input','paused','stalled','failed'].includes(String(detail.status || '').toLowerCase()) ? `<section class="pm-task-recovery-panel">
                <div class="pm-card-head pm-task-recovery-head">Needs You / Recovery</div>
                ${_pmRenderTaskRecovery(detail)}
                <div style="display:flex;gap:8px;margin-top:10px;">
                  <textarea class="pm-textarea" data-task-reply="${escapeHtml(id)}" rows="2" placeholder="Reply to this task..." style="min-height:58px;"></textarea>
                  <button class="pm-btn primary" data-task-send="${escapeHtml(id)}" style="align-self:flex-end;">Send</button>
                </div>
              </section>` : ''}
              <section><div class="pm-card-head">Progress</div>${_pmRenderTaskProgress(_pmTaskProgressItems(detail))}</section>
              ${_pmRenderTaskPromptDisclosure(detail)}
              <section><div class="pm-card-head">Evidence Bus</div>${_pmRenderTaskEvidence(detailEvidence)}</section>
              <section><div class="pm-card-head">Process Log</div>${_pmRenderTaskJournal(detail.journal)}</section>
            `}
          </div>` : ''}
        </article>
      `;
    }).join('');
    wireTaskCards();
    const nextJournal = listEl.querySelector('[data-pm-task-journal]');
    if (nextJournal && journalSnapshot) {
      const applyJournalScroll = () => {
        if (journalSnapshot.nearBottom) nextJournal.scrollTop = nextJournal.scrollHeight;
        else nextJournal.scrollTop = Math.max(0, nextJournal.scrollHeight - nextJournal.clientHeight - Number(journalSnapshot.distanceFromBottom || 0));
      };
      applyJournalScroll();
      requestAnimationFrame(applyJournalScroll);
    }
    if (bodyEl && bodySnapshot) {
      const nextTop = Math.min(bodySnapshot.top, Math.max(0, bodyEl.scrollHeight - bodyEl.clientHeight));
      bodyEl.scrollLeft = 0;
      bodyEl.scrollTop = nextTop;
    }
  }

  function wireTaskCards() {
    listEl.querySelectorAll('.pm-task-card').forEach(card => {
      card.addEventListener('click', async (event) => {
        if (event.target.closest('button, textarea, input, a, summary')) return;
        const id = card.getAttribute('data-task-id');
        expandedId = expandedId === id ? '' : id;
        paint();
        if (expandedId && !details[expandedId]) await loadDetail(expandedId);
      });
    });
    listEl.querySelectorAll('[data-task-action]').forEach(btn => {
      btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const id = btn.getAttribute('data-task-id');
        const actionName = btn.getAttribute('data-task-action');
        btn.disabled = true;
        try {
          const r = await runBgTaskAction(id, actionName);
          if (!r || r.success === false) throw new Error(r?.error || 'Action failed');
          pmToast(actionName === 'delete' ? 'Task removed' : 'Task updated', 'success');
          delete details[id];
          await load();
        } catch (err) {
          pmToast(err.message || 'Action failed', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });
    listEl.querySelectorAll('[data-task-send]').forEach(btn => {
      btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const id = btn.getAttribute('data-task-send');
        const input = listEl.querySelector(`[data-task-reply="${CSS.escape(id)}"]`);
        const message = String(input?.value || '').trim();
        if (!message) return;
        btn.disabled = true;
        try {
          const r = await sendBgTaskMessage(id, message);
          if (!r || r.success === false) throw new Error(r?.error || 'Send failed');
          if (input) input.value = '';
          pmToast('Reply sent', 'success');
          delete details[id];
          await loadDetail(id);
        } catch (err) {
          pmToast(err.message || 'Send failed', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  async function loadDetail(id) {
    try {
      const [detail, ev] = await Promise.all([loadBgTaskDetail(id), loadBgTaskEvidence(id)]);
      if (detail?.success && detail.task) details[id] = { task: detail.task, evidenceBus: detail.evidenceBus || null };
      evidence[id] = ev || [];
    } catch (err) {
      details[id] = { task: null, error: err?.message || 'Failed to load task detail' };
    }
    paint();
  }

  filterEl.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      filterEl.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      currentFilter = b.getAttribute('data-filter');
      expandedId = '';
      paint();
    });
  });

  function applyTaskList(nextTasks) {
    allTasks = Array.isArray(nextTasks) ? nextTasks : [];
    if (expandedId) {
      const linkedTask = allTasks.find(t => String(t.id || '') === expandedId);
      if (linkedTask) {
        currentFilter = _pmTaskFilter(linkedTask.status);
        filterEl.querySelectorAll('button').forEach(x => {
          x.classList.toggle('active', x.getAttribute('data-filter') === currentFilter);
        });
      }
    } else if (allTasks.length && !allTasks.some(t => _pmTaskFilter(t.status) === currentFilter)) {
      const fallbackFilter = PM_TASK_FILTERS.find(f => allTasks.some(t => _pmTaskFilter(t.status) === f.key))?.key;
      if (fallbackFilter) {
        currentFilter = fallbackFilter;
        filterEl.querySelectorAll('button').forEach(x => {
          x.classList.toggle('active', x.getAttribute('data-filter') === currentFilter);
        });
      }
    }
    const activeCount = allTasks.filter(t => !['complete','failed'].includes(_pmTaskFilter(t.status))).length;
    countEl.textContent = `${activeCount} active`;
    paint();
  }

  async function load({ resetExpandedDetail = false, force = false } = {}) {
    try {
      applyTaskList(await loadBgTasks({ force }));
      if (expandedId) {
        if (resetExpandedDetail) delete details[expandedId];
        await loadDetail(expandedId);
      }
    } catch (err) {
      if (!allTasks.length) {
        listEl.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clipboard}</div><h2>Could not load tasks</h2><p>${escapeHtml(err.message || '')}</p></div>`;
      }
    }
  }

  page.querySelector('#pm-tasks-refresh').addEventListener('click', () => { listEl.innerHTML = _tasksSkeleton(); load({ resetExpandedDetail: true, force: true }); });
  const cachedTasks = getCachedMobilePageData('tasks', 21_600_000);
  if (Array.isArray(cachedTasks)) {
    applyTaskList(cachedTasks);
    load({ force: true }).catch(() => {});
  } else {
    await load({ force: true });
  }
  refreshTimer = setInterval(() => load({ force: true }).catch(() => {}), 5000);
  page._pmCleanup = () => { if (refreshTimer) clearInterval(refreshTimer); };
}

export function renderPlaceholderPage(page, { title, iconName = 'spark', subtitle, leftIcon = 'menu', onBack, navigate }) {
  page.innerHTML = `
    ${renderMobileHeader({ title, online: true, leftIcon, hideTitle: title === 'Creative' || title === 'Subagents' || title === 'Proposals' })}
    <div class="pm-body">
      <div class="pm-empty">
        <div class="pm-empty-icon">${ICONS[iconName] || ICONS.spark}</div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(subtitle || 'Coming soon to Prometheus Mobile.')}</p>
      </div>
    </div>
  `;
  wireHeaderActions(page, { onBack: onBack || (() => navigate && navigate('#mobile/chat')) });
}

export {
  _pmRenderTaskProgress,
  _pmRenderTaskPromptDisclosure,
  _pmTaskPill,
  _pmTaskProgressItems,
};
