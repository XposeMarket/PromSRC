import { preserveRequestCards } from '../features/tasks/preserve-request-cards.js';


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

import { wsEventBus } from '../ws.js';
import { renderProviderLogo } from '../components/provider-logo.js';
import { buildTaskCard, detailSections, formatDuration as formatTaskDuration, dispatchedMessage } from '../features/tasks/task-card-view-model.js';
import { isNeedsYouTask, needsYouCount, needsYouEntries, needsYouTaskIds, nyRelTime } from '../needs-you-view-model.js';
import {
  approveMobileApproval,
  denyMobileApproval,
  loadMobileNeedsYou,
  cancelMobileQuestion,
} from './mobile-api.js';

/* ---------------- TASKS PAGE ---------------- */

function nyOpenThread(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  if (typeof window.pmOpenPrometheusThread === 'function') window.pmOpenPrometheusThread(sid);
  else window.location.hash = `#mobile/chat/${encodeURIComponent(sid)}`;
}

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
  return '<div class="pm-more-skeleton pm-tasks-skel" aria-hidden="true"><span></span><span></span><span></span></div>';
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
      const brainLabel = _pmBrainTaskLabel(t);
      const sourceLabel = brainLabel || t.actor || t.source || 'task';
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
  { key: 'needs_you', label: 'Needs You' },
  { key: 'running', label: 'In Progress' },
  { key: 'complete', label: 'Completed' },
  { key: 'paused', label: 'Paused' },
  { key: 'failed', label: 'Failed' },
  { key: 'queued', label: 'Queued' },
];

function _pmTaskStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'completed' || s === 'done' || s === 'succeeded') return 'complete';
  if (s === 'awaiting_user_input') return 'needs_assistance';
  if (s === 'waiting_subagent' || s === 'in_progress') return 'running';
  if (s === 'cancelled') return 'failed';
  if (s === 'interrupted') return 'stalled';
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

function _pmBrainTaskLabel(task) {
  const job = String(task?.brainJob || '').trim().toLowerCase();
  if (job === 'thought') return 'Brain Thought';
  if (job === 'dream_cleanup') return 'Brain Dream Cleanup';
  if (job === 'dream') return 'Brain Dream';
  return '';
}

function _pmIsBrainTask(task) {
  return Boolean(_pmBrainTaskLabel(task))
    || /^brain_(?:thought|dream)(?:_|$)/i.test(String(task?.sessionId || ''));
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
// Moved to the shared view-model; kept as an alias for existing callers.
function _pmTaskDispatchedMessage(task) {
  return dispatchedMessage(task);
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
  if (_pmIsBrainTask(task)) return null;
  const s = String(task?.status || '').toLowerCase();
  if (s === 'running') return { action: 'pause', label: 'Pause' };
  if (['paused', 'queued', 'stalled', 'needs_assistance', 'awaiting_user_input'].includes(s)) return { action: 'resume', label: 'Resume' };
  if (s === 'failed') return { action: 'restart', label: 'Restart' };
  return null;
}

// ── Option B live run cards (shared view-model: features/tasks/task-card-view-model.js) ──
function _pmLrSegments(progress) {
  if (!progress.total) return '';
  return `<div class="pm-lr-bar" role="img" aria-label="${progress.done} of ${progress.total} steps done">${progress.items.map((item) => `<span class="pm-lr-seg is-${item.state}"></span>`).join('')}</div>`;
}

function _pmRenderLiveCard(t, { isOpen = false, body = '' } = {}) {
  const card = buildTaskCard(t);
  const id = escapeHtml(card.id);
  const brainLabel = _pmBrainTaskLabel(t);
  const compactDone = card.status === 'complete' && !isOpen;
  const progressLine = card.progress.total
    ? `<div class="pm-lr-progress">${_pmLrSegments(card.progress)}<span class="pm-lr-count">${card.progress.done}/${card.progress.total}</span></div>` : '';
  const stepLine = !card.terminal && card.progress.currentText
    ? `<div class="pm-lr-step"><span class="pm-lr-step-mark">›</span> ${escapeHtml(card.progress.currentText.slice(0, 160))}</div>` : '';
  return `<article class="pm-card pm-task-card pm-lr-card tone-${card.tone}${compactDone ? ' is-compact' : ''}${isOpen ? ' is-open' : ''}${card.planned ? ' pm-planned-chat' : ''}" data-task-id="${id}" data-task-kind="${escapeHtml(card.kind)}">
    <div class="pm-lr-head">
      <span class="pm-lr-avatar kind-${escapeHtml(card.kind)}${card.avatar.logoKey ? ' has-logo' : ''}" data-provider="${escapeHtml(card.avatar.logoKey)}" aria-hidden="true">${card.avatar.logoKey ? renderProviderLogo(card.avatar.providerId, card.avatar.model, 'pm-lr-logo') : escapeHtml(card.initials)}</span>
      <div class="pm-lr-who">
        <div class="pm-lr-actor">${escapeHtml(brainLabel || card.actor)}${brainLabel && t.brainDate ? ` · ${escapeHtml(String(t.brainDate))}` : ''}</div>
        <div class="pm-lr-sub">${escapeHtml(card.sub)}</div>
      </div>
      <span class="pm-lr-pill tone-${card.tone}">${escapeHtml(card.statusLabel)}</span>
    </div>
    <div class="pm-lr-title">${escapeHtml(card.title)}</div>
    ${compactDone ? '' : `${progressLine}${stepLine}
    ${card.tool ? `<div class="pm-lr-now">now: <code>${escapeHtml(card.tool)}</code></div>` : ''}
    ${card.stalledFor ? `<div class="pm-lr-stall">No progress for ${escapeHtml(card.stalledFor)}. Probably stuck.</div>` : ''}
    ${card.attention ? `<div class="pm-lr-attn tone-${card.tone}"><strong>Prometheus:</strong> ${escapeHtml(card.attention)}</div>` : ''}`}
    ${body}
  </article>`;
}

function _pmRenderActivity(rows) {
  if (!rows.length) return '<div class="pm-card-body">No activity recorded yet.</div>';
  return `<div class="pm-lr-activity" data-pm-task-journal>${rows.map((row, idx) => {
    const time = row.t ? `<span class="pm-lr-act-time">${escapeHtml(_formatTimeAgo(row.t))}</span>` : '';
    if (row.type === 'hidden') {
      return `<details class="pm-lr-hidden"><summary>Hiding ${row.count} update${row.count === 1 ? '' : 's'} · Show</summary>${row.rows.map(r => `<div class="pm-lr-act is-status">${escapeHtml(String(r.text || r.kind || '').slice(0, 240))}</div>`).join('')}</details>`;
    }
    if (row.type === 'tool') {
      return `<div class="pm-lr-act is-tool${row.error ? ' is-error' : ''}" data-act="${idx}"><div class="pm-lr-act-line"><code>${escapeHtml(row.name || 'tool')}</code>${row.pending ? '<span class="pm-lr-act-run">running…</span>' : ''}${time}</div>${row.call ? `<div class="pm-lr-act-call">${escapeHtml(String(row.call).slice(0, 200))}</div>` : ''}${row.result ? `<div class="pm-lr-act-result">→ ${escapeHtml(String(row.result).slice(0, 240))}</div>` : ''}</div>`;
    }
    if (row.type === 'error') return `<div class="pm-lr-act is-error"><div class="pm-lr-act-line"><strong>Error</strong>${row.name ? ` <code>${escapeHtml(row.name)}</code>` : ''}${time}</div><div>${escapeHtml(String(row.text || '').slice(0, 400))}</div></div>`;
    return `<div class="pm-lr-act is-status"><div class="pm-lr-act-line">${escapeHtml(String(row.text || '').slice(0, 300))}${time}</div></div>`;
  }).join('')}</div>`;
}

function _pmRenderProgressList(progress) {
  if (!progress.total) return '<div class="pm-card-body">No plan steps recorded yet.</div>';
  return `<ol class="pm-lr-steps">${progress.items.map((item, idx) => `<li class="is-${item.state}"><span class="pm-lr-step-dot">${item.state === 'done' ? '✓' : item.state === 'failed' ? '!' : idx + 1}</span><span class="pm-lr-step-text">${escapeHtml(item.text.slice(0, 260))}</span>${item.durationMs != null ? `<span class="pm-lr-step-time">${escapeHtml(formatTaskDuration(item.durationMs))}</span>` : ''}</li>`).join('')}</ol>`;
}

function _pmRenderTaskDetail(listTask, detail, detailEvidence, tab) {
  const merged = { ...listTask, ...detail };
  const id = escapeHtml(String(listTask.id || ''));
  const view = detailSections(merged, { evidence: detailEvidence });
  const brainLabel = _pmBrainTaskLabel(merged);
  const action = view.openChat ? null : _pmTaskAction(merged);
  const tabs = ['overview', 'activity', 'evidence'].map(key => `<button type="button" class="${tab === key ? 'active' : ''}" data-task-tab="${key}" data-task-id="${id}">${key[0].toUpperCase()}${key.slice(1)}</button>`).join('');
  let content = '';
  if (tab === 'activity') {
    content = `<section>${_pmRenderActivity(view.activity)}</section>`;
  } else if (tab === 'evidence') {
    const artifacts = view.artifacts.length ? `<section><div class="pm-card-head">Artifacts</div><ul class="pm-lr-artifacts">${view.artifacts.map(a => `<li>${escapeHtml(String(a?.path || a?.name || a || '').slice(0, 240))}</li>`).join('')}</ul></section>` : '';
    content = `<section><div class="pm-card-head">Evidence</div>${_pmRenderTaskEvidence(view.evidence)}</section>${artifacts}`;
  } else {
    const recovery = ['needs_assistance', 'awaiting_user_input', 'paused', 'stalled', 'failed'].includes(String(merged.status || '').toLowerCase()) && !view.openChat;
    content = `
      ${view.attention ? `<section class="pm-lr-attn-box tone-${view.card.tone}"><div class="pm-card-head">What Prometheus needs</div><div class="pm-card-body">${escapeHtml(view.attention)}</div></section>` : ''}
      ${recovery ? `<section class="pm-task-recovery-panel"><div class="pm-card-head pm-task-recovery-head">Recovery conversation</div>${_pmRenderTaskRecovery(merged)}</section>` : ''}
      ${brainLabel ? `<div class="pm-lr-brain"><strong>${escapeHtml(brainLabel)}</strong>${merged.brainDate ? ` · ${escapeHtml(String(merged.brainDate))}` : ''}${merged.brainRunId ? `<br><span>Run ${escapeHtml(String(merged.brainRunId))}</span>` : ''}${merged.brainArtifact ? `<br><span>Primary artifact: ${escapeHtml(String(merged.brainArtifact))}</span>` : ''}</div>` : ''}
      ${view.result ? `<section><div class="pm-card-head">Result</div><div class="pm-card-body pm-task-final-response markdown-body pm-task-markdown">${_renderMobileMarkdown(view.result)}</div></section>` : ''}
      ${view.startedFrom ? `<section class="pm-task-prompt-section"><div class="pm-card-head">Started from</div><div class="pm-card-body pm-lr-origin">${escapeHtml(view.startedFrom.slice(0, 4000))}</div>${view.rawInstructions ? `<details class="pm-task-prompt-disclosure"><summary>Show full agent instructions</summary><div class="pm-card-body pm-task-prompt-body">${escapeHtml(view.rawInstructions)}</div></details>` : ''}</section>` : ''}
      <section><div class="pm-card-head">Progress</div>${_pmRenderProgressList(view.progress)}</section>`;
  }
  const composer = view.openChat
    ? `<div class="pm-lr-actions"><button class="pm-btn pm-btn-primary" data-ny-open="${escapeHtml(String(merged.sessionId || ''))}">Open chat</button></div>`
    : `<div class="pm-lr-actions">
        ${action ? `<button class="pm-btn ghost" data-task-action="${action.action}" data-task-id="${id}">${escapeHtml(action.label)}</button>` : ''}
        ${['failed', 'complete'].includes(_pmTaskFilter(merged.status)) ? `<button class="pm-btn ghost danger" data-task-action="delete" data-task-id="${id}">${ICONS.trash} Remove</button>` : ''}
      </div>
      ${view.canMessage ? `<div class="pm-lr-composer"><textarea class="pm-textarea" data-task-reply="${id}" rows="2" placeholder="Message this task..."></textarea><button class="pm-btn primary" data-task-send="${id}">Send</button></div>` : ''}`;
  return `<div class="pm-tabs pm-lr-tabs">${tabs}</div><div class="pm-lr-tab-body">${content}</div>${composer}`;
}

export async function renderTasksPage(page, { navigate, taskId = '' }) {
  let taskInteractions = null;
  const taskPageSize = 40;
  const extras = `<span class="pm-spacer"></span><span class="pm-count-pill" id="pm-tasks-count"></span><button class="pm-icon-btn" id="pm-tasks-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Tasks', online: true, extras, hideTitle: true, hideBrand: true })}
    <div class="pm-body" id="pm-tasks-body">
      <div class="pm-tabs" id="pm-tasks-filter" style="margin-top:4px;overflow-x:auto;justify-content:flex-start;">
        ${PM_TASK_FILTERS.map((f) => `<button class="${f.key === 'running' ? 'active' : ''}" data-filter="${f.key}">${escapeHtml(f.label)} <span data-count="${f.key}"></span></button>`).join('')}
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
  let needsYouItems = [];
  let nyExpandedId = '';
  let nyAutoOpened = false;
  const filterOf = (t) => (isNeedsYouTask(t, needsYouTaskIds(needsYouItems)) ? 'needs_you' : _pmTaskFilter(t.status));
  let visibleLimit = taskPageSize;
  let lastPaintSignature = '';
  let details = {};
  let evidence = {};
  const detailTab = {};
  let refreshTimer = null;
  let eventRefreshTimer = null;

  function paint() {
    const counts = PM_TASK_FILTERS.reduce((acc, f) => { acc[f.key] = 0; return acc; }, {});
    for (const t of allTasks) counts[filterOf(t)] = (counts[filterOf(t)] || 0) + 1;
    counts.needs_you = needsYouCount(allTasks, needsYouItems);
    for (const f of PM_TASK_FILTERS) {
      const el = filterEl.querySelector(`[data-count="${f.key}"]`);
      if (el) el.textContent = counts[f.key] ? `(${counts[f.key]})` : '';
    }

    const nyEntries = currentFilter === 'needs_you' ? needsYouEntries(needsYouItems) : [];
    const tasks = allTasks.filter(t => filterOf(t) === currentFilter && !(t.sourceKind === 'planned_chat' && t.status === 'awaiting_user_input' && needsYouItems.some(item => item.sessionId === t.sessionId)));
    if (!tasks.length && !nyEntries.length) {
      lastPaintSignature = '';
      listEl.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clipboard}</div>${currentFilter === 'needs_you' ? '<h2>Nothing needs you right now.</h2><p>Questions, approvals and login requests will show up here.</p>' : '<h2>No tasks here</h2><p>Background tasks and agent runs will appear here.</p>'}</div>`;
      return;
    }

    const visibleTasks = tasks.slice(0, visibleLimit);
    const linkedTask = expandedId && tasks.find(t => String(t.id || '') === expandedId);
    if (linkedTask && !visibleTasks.includes(linkedTask)) visibleTasks.unshift(linkedTask);
    const paintSignature = JSON.stringify({
      ny: needsYouItems,
      nyExpandedId,
      filter: currentFilter,
      visibleLimit,
      expandedId,
      tasks: visibleTasks,
      detail: expandedId ? details[expandedId] : null,
      tab: expandedId ? detailTab[expandedId] || 'overview' : '',
      evidence: expandedId ? evidence[expandedId] : null,
      liveMinute: visibleTasks.some(t => ['running', 'pending'].includes(_pmTaskFilter(t.status)))
        ? Math.floor(Date.now() / 60_000) : 0,
    });
    if (paintSignature === lastPaintSignature) return;
    lastPaintSignature = paintSignature;
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

    const restoreRequestCards = preserveRequestCards(listEl, nyEntries);
    listEl.innerHTML = visibleTasks.map(t => {
      const id = String(t.id || '');
      const isOpen = id === expandedId;
      const detail = details[id]?.task;
      const detailEvidence = evidence[id] || details[id]?.evidenceBus?.entries || [];
      const body = isOpen ? `<div class="pm-task-expanded pm-lr-detail">
            ${!detail ? `<div class="pm-card-body">${details[id]?.error ? escapeHtml(details[id].error) : 'Loading task details...'}</div>` : _pmRenderTaskDetail(t, detail, detailEvidence, detailTab[id] || 'overview')}
          </div>` : '';
      return _pmRenderLiveCard(t, { isOpen, body });
    }).join('') + (tasks.length > visibleLimit
      ? `<button type="button" class="pm-btn ghost" data-pm-task-load-more style="display:block;margin:16px auto 24px;">Show more tasks (${Math.min(taskPageSize, tasks.length - visibleLimit)} of ${tasks.length - visibleLimit} remaining)</button>`
      : '');
    if (nyEntries.length) {
      listEl.insertAdjacentHTML('afterbegin', nyEntries.map(nyEntryHtml).join(''));
    }
    restoreRequestCards();
    wireNyEntries();
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
    listEl.querySelector('[data-pm-task-load-more]')?.addEventListener('click', () => {
      visibleLimit += taskPageSize;
      paint();
    });
    listEl.querySelectorAll('.pm-task-card').forEach(card => {
      card.addEventListener('click', async (event) => {
        if (event.target.closest('button, textarea, input, a, summary')) return;
        const id = card.getAttribute('data-task-id');
        expandedId = expandedId === id ? '' : id;
        paint();
        if (expandedId && !details[expandedId]) await loadDetail(expandedId);
      });
    });
    listEl.querySelectorAll('[data-task-tab]').forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        detailTab[btn.getAttribute('data-task-id')] = btn.getAttribute('data-task-tab');
        paint();
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
      nyAutoOpened = true; // user picked a tab; never auto-switch away from it
      expandedId = '';
      visibleLimit = taskPageSize;
      paint();
    });
  });

  function nyEntryHtml(entry) {
    const payload = { ...entry.item?.payload, sessionId: entry.sessionId };
    const original = ['question', 'browser_login'].includes(entry.kind) ? taskInteractions?.question(payload)
      : ['tool_approval', 'final_action_approval'].includes(entry.kind) ? taskInteractions?.approval(payload) : '';
    if (original) return `<article class="pm-card pm-ny-entry" data-ny-entry="${escapeHtml(entry.id)}" style="padding:12px;min-width:0;overflow-wrap:anywhere"><div class="pm-ny-original">${original}</div><div class="pm-ny-footer"><button class="pm-btn ghost" data-ny-open="${escapeHtml(entry.sessionId)}">Open chat</button></div></article>`;
    const id = escapeHtml(entry.id);
    const origin = escapeHtml(entry.sessionId);
    const isApproval = entry.kind === 'tool_approval' || entry.kind === 'final_action_approval';
    const rawId = escapeHtml(entry.rawId);
    let actions;
    if (isApproval) actions = `<button class="pm-btn" data-ny-deny="${rawId}">Reject</button><button class="pm-btn pm-btn-primary" data-ny-approve="${rawId}">Approve</button>`;
    else if (entry.kind === 'question' || entry.kind === 'browser_login') actions = `<button class="pm-btn" data-ny-skip="${rawId}">Cancel</button><button class="pm-btn pm-btn-primary" data-ny-open="${origin}">Answer in chat</button>`;
    else actions = `<button class="pm-btn pm-btn-primary" data-ny-open="${origin}">Open thread</button>`;
    const facts = nyExpandedId === entry.id && entry.facts.length
      ? `<dl class="ny-facts">${entry.facts.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>`
      : '';
    return `<article class="pm-card pm-ny-entry" style="padding:12px 14px;cursor:pointer;" data-ny-entry="${id}" data-kind="${escapeHtml(entry.kind)}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <strong style="flex:1;font-size:13px;line-height:1.3;">${escapeHtml(entry.title)}</strong>
        <span class="pm-pill orange">${escapeHtml(entry.kindLabel)}</span>
      </div>
      ${entry.summary ? `<div class="pm-card-body" style="font-size:12px;color:var(--pm-text-soft);margin-bottom:4px;">${escapeHtml(entry.summary)}</div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--pm-muted);gap:10px;">
        <span>${escapeHtml(entry.source)}</span><span>${escapeHtml(nyRelTime(entry.createdAt))}</span>
      </div>
      ${facts}
      <div class="pm-card-actions">${actions}</div>
    </article>`;
  }

  // Every action shows a busy state and surfaces failures; a failure re-enables the buttons.
  function wireNyEntries() {
    taskInteractions?.wire(listEl, needsYouEntries(needsYouItems), () => load({ force: true }));
    const busy = (el, run, okMessage) => el.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (el.disabled) return;
      const card = el.closest('.pm-ny-entry');
      card?.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      el.classList.add('is-busy');
      try {
        await run(el);
        if (okMessage) pmToast(okMessage, 'success');
      } catch (err) {
        pmToast(String(err?.message || err || 'Action failed'), 'error');
        card?.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        el.classList.remove('is-busy');
        return;
      }
      load({ force: true }).catch(() => {});
    });
    listEl.querySelectorAll('[data-ny-approve]').forEach((el) => busy(el, (b) => approveMobileApproval(b.dataset.nyApprove, '', { source: 'mobile' }), 'Approved'));
    listEl.querySelectorAll('[data-ny-deny]').forEach((el) => busy(el, (b) => denyMobileApproval(b.dataset.nyDeny, { source: 'mobile' }), 'Rejected'));
    listEl.querySelectorAll('[data-ny-skip]').forEach((el) => busy(el, (b) => cancelMobileQuestion(b.dataset.nySkip), 'Cancelled'));
    listEl.querySelectorAll('[data-ny-open]').forEach((el) => { el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      nyOpenThread(el.dataset.nyOpen);
    }; });
    listEl.querySelectorAll('.pm-ny-entry:not(:has([data-pm-q-card])):not(:has([data-pm-approval-id]))').forEach((card) => { card.onclick = (e) => {
      if (e.target.closest('button, a, input, textarea')) return;
      const id = card.getAttribute('data-ny-entry') || '';
      nyExpandedId = nyExpandedId === id ? '' : id;
      paint();
    }; });
  }

  function applyTaskList(nextTasks) {
    allTasks = Array.isArray(nextTasks) ? nextTasks : [];
    if (expandedId) {
      const linkedTask = allTasks.find(t => String(t.id || '') === expandedId);
      if (linkedTask) {
        currentFilter = filterOf(linkedTask);
        filterEl.querySelectorAll('button').forEach(x => {
          x.classList.toggle('active', x.getAttribute('data-filter') === currentFilter);
        });
      }
    } else if (!nyAutoOpened && allTasks.length && !allTasks.some(t => filterOf(t) === currentFilter) && !(currentFilter === 'needs_you' && needsYouEntries(needsYouItems).length)) {
      const fallbackFilter = PM_TASK_FILTERS.find(f => allTasks.some(t => filterOf(t) === f.key))?.key;
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
      const [tasksRes, nyRes] = await Promise.allSettled([loadBgTasks({ force }), loadMobileNeedsYou()]);
      if (nyRes.status === 'fulfilled' && Array.isArray(nyRes.value)) needsYouItems = nyRes.value;
      if (!taskInteractions && needsYouItems.some(item => ['question', 'browser_login', 'tool_approval', 'final_action_approval'].includes(item.kind))) {
        try {
          const { prepareMobileTaskInteractions } = await import('./mobile-pages.js');
          taskInteractions = await prepareMobileTaskInteractions();
        } catch (error) { console.warn('[Tasks] Inline interactions unavailable; using source-chat fallback.', error); }
      }
      if (tasksRes.status === 'rejected') throw tasksRes.reason;
      applyTaskList(tasksRes.value);
      if (!nyAutoOpened) {
        nyAutoOpened = true;
        if (!expandedId && needsYouCount(allTasks, needsYouItems) > 0) {
          currentFilter = 'needs_you';
          filterEl.querySelectorAll('button').forEach(x => x.classList.toggle('active', x.getAttribute('data-filter') === currentFilter));
          paint();
        }
      }
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

  // Task-panel events are the fast path for live Brain and background-task
  // updates. Keep the five-second poll as a recovery path for sleeping mobile
  // tabs and reconnects, but do not make the user wait for it to see a tool,
  // reasoning, or completion event.
  const taskEventNames = ['planned_chat_updated', 'task_running', 'task_panel_update', 'task_complete', 'task_failed'];
  const onTaskEvent = (event = {}) => {
    if (!page.isConnected || (!event.taskId && !event.runtimeId)) return;
    if (eventRefreshTimer) clearTimeout(eventRefreshTimer);
    eventRefreshTimer = setTimeout(() => {
      eventRefreshTimer = null;
      load({ force: true }).catch(() => {});
    }, 120);
  };
  taskEventNames.forEach((eventName) => wsEventBus.on(eventName, onTaskEvent));
  const onNeedsYouChange = () => { load({ force: true }).catch(() => {}); };
  const needsYouEventNames = ['needs_you_changed', 'question_created', 'question_answered', 'question_cancelled', 'question_expired', 'approval_created', 'approval_resolved', 'proposal_created'];
  needsYouEventNames.forEach((eventName) => wsEventBus.on(eventName, onNeedsYouChange));

  page.querySelector('#pm-tasks-refresh').addEventListener('click', () => { load({ resetExpandedDetail: true, force: true }); });
  const cachedTasks = getCachedMobilePageData('tasks', 21_600_000);
  if (Array.isArray(cachedTasks)) {
    applyTaskList(cachedTasks);
    load({ force: true }).catch(() => {});
  } else {
    await load({ force: true });
  }
  refreshTimer = setInterval(() => load({ force: true }).catch(() => {}), 5000);
  page._pmCleanup = () => {
    if (refreshTimer) clearInterval(refreshTimer);
    if (eventRefreshTimer) clearTimeout(eventRefreshTimer);
    taskEventNames.forEach((eventName) => wsEventBus.off(eventName, onTaskEvent));
    needsYouEventNames.forEach((eventName) => wsEventBus.off(eventName, onNeedsYouChange));
  };
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
